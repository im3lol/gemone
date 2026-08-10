import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

import {
  INVALIDATION_CHANNEL,
  INVALIDATION_PUBLISHER,
  INVALIDATION_SUBSCRIBER,
} from './invalidation.constants';
import {
  INVALIDATION_DOMAINS,
  INVALIDATION_PROTOCOL_VERSION,
  parseInvalidationMessage,
  serializeInvalidationMessage,
  type InvalidationDomain,
  type InvalidationEntry,
} from './invalidation-message';

/**
 * Called when something in a domain changed somewhere else.
 *
 * `null` means "everything in your domain" — either because the domain has no
 * key, or because the bus could not tell what changed and is being
 * conservative.
 */
export type InvalidationHandler = (entry: InvalidationEntry | null) => void | Promise<void>;

/**
 * Cross-process cache invalidation — ARCHITECTURE.md §14.3.
 *
 * > *"It is cached in-process per replica and invalidated by a Redis pub/sub
 * > message published on every write, so an admin's change propagates to all
 * > replicas within milliseconds."*
 *
 * This is the second half of that sentence. The first half has existed since
 * Feature 4; without this one, a value changed through the admin panel took
 * effect on the `api` process that wrote it and nowhere else — and `worker` is
 * where conversions are priced and credited (TODO T3).
 *
 * ## What this is not
 *
 * Not `core/cache`. T3 recorded itself as blocked on that module, which was a
 * mis-statement this feature had to correct: nothing here caches anything.
 * Publishing a notification and holding a value are different jobs, and the
 * cache §14.1 describes still has no consumer. Building one to unblock a
 * channel that does not need it would be the framework P6 forbids.
 *
 * Not a message queue either. **Redis pub/sub is best-effort and has no
 * persistence**: a process that is disconnected when a message is published
 * never receives it, and there is no acknowledgement to notice that with. That
 * is a deliberate and acceptable trade for this job — see the class of
 * mitigations below — but it means nothing may be built on an assumption of
 * delivery. Durable work goes on a BullMQ queue (§13), which is what queues are
 * for.
 *
 * ## The three things that make best-effort safe here
 *
 * 1. **The writer never depends on the message.** It drops its own entry
 *    locally first; the broadcast is what the *other* processes get. A publish
 *    that fails leaves the system exactly where it was before this feature —
 *    degraded, never wrong (§14.4).
 * 2. **A reconnect resyncs.** A subscriber that comes back cannot know what it
 *    missed, so it assumes it missed everything and drops every cached copy.
 * 3. **An unreadable message resyncs too**, for the same reason — see
 *    `parseInvalidationMessage`.
 *
 * ## Two connections, not one
 *
 * A Redis connection in subscriber mode may issue no other commands, so the
 * publisher cannot share it. They are also configured differently on purpose:
 * the publisher fails fast (`enableOfflineQueue: false`) so a Redis outage
 * cannot hold an admin's write open waiting for a notification that is not
 * required for correctness, while the subscriber retries indefinitely because
 * its whole job is to still be there afterwards.
 */
@Injectable()
export class InvalidationBus implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(InvalidationBus.name);

  /**
   * Identifies this process for the lifetime of this process.
   *
   * Not the hostname or the pid: two processes from one image on one host share
   * a hostname, and a pid is reused. This only has to be unique among the
   * processes alive at the same moment, and a v7 uuid is that with no
   * coordination.
   */
  readonly instanceId = uuidv7();

  private readonly handlers = new Map<InvalidationDomain, InvalidationHandler[]>();

  /** True once the channel has been subscribed at least once. */
  private everSubscribed = false;

  /**
   * Domains whose broadcast was lost because the publisher could not send it.
   *
   * The reason this has to exist: a *publisher-only* disconnect leaves no other
   * process aware that anything happened. The subscribers never dropped their
   * connections, so none of them resyncs (D61), and configuration has no
   * periodic re-read to fall back on the way the provider registry does — so
   * the stale value would survive until that key was written again or the
   * process restarted. See D64.
   *
   * A set of domains rather than the entries themselves, deliberately. Keeping
   * the lost entries would make this a buffer, and a buffer is the first half of
   * a message queue — which D58 says this is not. One whole-domain message on
   * recovery is always a superset of what was lost, costs one repopulating read
   * per key actually used, and needs no memory that can itself be lost.
   */
  private readonly unannounced = new Set<InvalidationDomain>();

  /** Suppresses repeated connection-error logs while Redis is away. */
  private reportedDisconnect = false;

  private shuttingDown = false;

  constructor(
    @Inject(INVALIDATION_PUBLISHER) private readonly publisher: Redis,
    @Inject(INVALIDATION_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  /**
   * Registers interest in a domain. Called from `onModuleInit`, which Nest runs
   * for every module before `onApplicationBootstrap` — so every handler is in
   * place before the channel is subscribed and the first message can arrive.
   *
   * The bus knows nothing about its subscribers, which is what keeps `core/config`
   * and `modules/providers` from having to know about each other or about it in
   * any direction but this one. Same shape as `HealthService.register()`.
   */
  subscribe(domain: InvalidationDomain, handler: InvalidationHandler): void {
    const existing = this.handlers.get(domain);

    if (existing) {
      existing.push(handler);
      return;
    }

    this.handlers.set(domain, [handler]);
  }

  /**
   * Tells every other process that an entry changed.
   *
   * **Never throws.** A caller has already committed a database transaction and
   * dropped its own cache entry by the time it gets here; failing the request at
   * this point would report a change that did happen as one that did not. The
   * failure is logged at `error` because a change that should have propagated
   * did not (§17.1).
   *
   * What it does *not* do any more is leave the loss unresolved. A failed send
   * records its domain, and the next time this connection comes back the domain
   * is announced wholesale — see `announceMissed` and D64.
   */
  async publish(domain: InvalidationDomain, entry: InvalidationEntry | null): Promise<void> {
    const failure = await this.send(domain, entry);
    if (!failure) return;

    this.unannounced.add(domain);

    this.logger.error(
      { domain, entry, err: failure.message },
      'Could not broadcast a cache invalidation; other processes keep their cached copy until this connection recovers',
    );
  }

  onApplicationBootstrap(): void {
    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel === INVALIDATION_CHANNEL) this.receive(raw);
    });

    /*
     * `ready` fires on the first connection and again after every successful
     * reconnect, which is exactly the set of moments the subscription has to be
     * (re-)established and — from the second one on — the cache has to be
     * treated as suspect.
     */
    this.subscriber.on('ready', () => {
      void this.establish();
    });

    this.subscriber.on('error', (error: Error) => this.reportConnectionError(error));
    this.publisher.on('error', (error: Error) => this.reportConnectionError(error));

    /*
     * The publisher's own recovery, which is a different event from the
     * subscriber's and fixes a different problem.
     *
     * A subscriber reconnecting means "I may have missed something" (D61). A
     * publisher reconnecting means "somebody else may have missed something I
     * said" — and nobody else can detect that, because their connections were
     * never interrupted. This is the only place it can be noticed.
     */
    this.publisher.on('ready', () => {
      void this.announceMissed();
    });

    /*
     * Not awaited, and the process is not held up if Redis is unreachable.
     *
     * A cache-invalidation channel is not a reason to refuse to start (§14.4:
     * cache failures degrade, never fail) — and a boot that blocks on Redis
     * turns a Redis blip into a deployment that cannot roll forward. Readiness
     * already reports Redis separately, so an operator is not left guessing.
     */
    if (this.subscriber.status === 'ready') void this.establish();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;

    // `quit` waits for pending replies; a subscriber that is mid-reconnect has
    // none and would hang, so a failed quit falls back to dropping the socket.
    await Promise.all([safeQuit(this.publisher), safeQuit(this.subscriber)]);
  }

  // --- Internals ------------------------------------------------------------

  /** Sends one message. Returns the failure, or null when it went out. */
  private async send(
    domain: InvalidationDomain,
    entry: InvalidationEntry | null,
  ): Promise<Error | null> {
    try {
      await this.publisher.publish(
        INVALIDATION_CHANNEL,
        serializeInvalidationMessage({
          v: INVALIDATION_PROTOCOL_VERSION,
          origin: this.instanceId,
          domain,
          entry,
        }),
      );

      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Announces every domain whose broadcast was lost, now that sending works
   * again — D64.
   *
   * ## Why this is not covered by the subscriber's resync
   *
   * D61 handles the case where *this* process was away. This is the mirror
   * image: this process was fine and its **outgoing** message was not, so the
   * processes that needed it never noticed anything at all. Their subscriptions
   * were never interrupted, so nothing on their side will ever resync — and
   * configuration, unlike the provider registry, has no periodic re-read to
   * heal it. Without this, the stale value survives until the key is written
   * again or the process is restarted.
   *
   * ## Two things it deliberately does not do
   *
   * **It does not fire when nothing was lost.** A publisher blip during a quiet
   * period announces nothing, so an idle reconnection cannot make every process
   * drop its caches. The set is only ever filled by a send that actually failed.
   *
   * **It does not replay the entries.** One whole-domain message per affected
   * domain is a superset of whatever was lost, and it needs no record of the
   * individual changes — which is the point, because a record of undelivered
   * messages is a buffer, and a buffer is how this would drift into being the
   * message queue D58 says it is not.
   */
  private async announceMissed(): Promise<void> {
    if (this.shuttingDown || this.unannounced.size === 0) return;

    const domains = [...this.unannounced];
    this.unannounced.clear();

    this.logger.warn(
      { domains },
      'The invalidation publisher recovered; announcing that everything in the domains it could not reach may have changed',
    );

    for (const domain of domains) {
      const failure = await this.send(domain, null);

      if (failure) {
        /*
         * Put it back and stop. The connection has gone again mid-recovery, so
         * the remaining domains would fail too — and the next `ready` is
         * exactly this method, which will pick them all up.
         */
        for (const remaining of domains.slice(domains.indexOf(domain))) {
          this.unannounced.add(remaining);
        }

        this.logger.error(
          { domain, err: failure.message },
          'The invalidation publisher failed again while announcing missed changes; will retry when it recovers',
        );
        return;
      }
    }
  }

  /**
   * Subscribes, and resyncs if this is a reconnection.
   *
   * A subscriber that was away cannot know whether anything was published while
   * it was — pub/sub has no backlog to replay and no sequence number to compare
   * — so it assumes the worst and drops everything. The cost is one repopulating
   * read per key actually used afterwards; the alternative is a process serving
   * a value that changed during a network blip, indefinitely and silently.
   */
  private async establish(): Promise<void> {
    if (this.shuttingDown) return;

    const isReconnect = this.everSubscribed;

    try {
      await this.subscriber.subscribe(INVALIDATION_CHANNEL);
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Could not subscribe to the invalidation channel; this process will not see changes made elsewhere',
      );
      return;
    }

    this.everSubscribed = true;
    this.reportedDisconnect = false;

    if (isReconnect) {
      this.logger.warn(
        { channel: INVALIDATION_CHANNEL },
        'Resubscribed to the invalidation channel after a disconnect; dropping every cached copy because there is no way to know what was missed',
      );
      this.dispatchEverything();
      return;
    }

    this.logger.log(
      { channel: INVALIDATION_CHANNEL, instanceId: this.instanceId },
      'Listening for cache invalidations from other processes',
    );
  }

  private receive(raw: string): void {
    const parsed = parseInvalidationMessage(raw);

    if (parsed.status === 'unintelligible') {
      this.logger.warn(
        { reason: parsed.reason },
        'Received an invalidation message this build cannot read; dropping every cached copy rather than assuming nothing changed',
      );
      this.dispatchEverything();
      return;
    }

    // Our own echo. The entry was dropped locally before this was published.
    if (parsed.message.origin === this.instanceId) return;

    this.dispatch(parsed.message.domain, parsed.message.entry);
  }

  /** Every registered domain, told that everything in it is suspect. */
  private dispatchEverything(): void {
    for (const domain of Object.values(INVALIDATION_DOMAINS)) {
      this.dispatch(domain, null);
    }
  }

  private dispatch(domain: InvalidationDomain, entry: InvalidationEntry | null): void {
    const handlers = this.handlers.get(domain);
    if (!handlers) return;

    for (const handler of handlers) {
      /*
       * One handler's failure must not stop the next one's. They belong to
       * unrelated caches and there is no ordering between them; letting a
       * rejected registry reload swallow a configuration invalidation would
       * make one bug produce two stale caches.
       */
      try {
        const result = handler(entry);
        if (result) void result.catch((error: unknown) => this.reportHandlerError(domain, error));
      } catch (error) {
        this.reportHandlerError(domain, error);
      }
    }
  }

  private reportHandlerError(domain: InvalidationDomain, error: unknown): void {
    this.logger.error(
      { domain, err: error instanceof Error ? error.message : String(error) },
      'An invalidation handler failed; that cache may still hold a stale value',
    );
  }

  /**
   * Logs a connection problem once per outage rather than once per retry.
   *
   * ioredis re-emits `error` on every reconnection attempt. Unthrottled, a
   * Redis restart writes a line every few hundred milliseconds and buries
   * whatever else was happening — and the listener cannot simply be omitted,
   * because an `error` event with no listener terminates the process.
   */
  private reportConnectionError(error: Error): void {
    if (this.reportedDisconnect || this.shuttingDown) return;

    this.reportedDisconnect = true;
    this.logger.warn(
      { err: error.message },
      'Lost the Redis connection used for cache invalidation; changes made by other processes will not be seen until it returns',
    );
  }
}

async function safeQuit(redis: Redis): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
