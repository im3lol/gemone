import { describe, expect, it, vi } from 'vitest';

import { InvalidationBus, type InvalidationHandler } from './invalidation.bus';
import { INVALIDATION_CHANNEL } from './invalidation.constants';
import {
  INVALIDATION_DOMAINS,
  INVALIDATION_PROTOCOL_VERSION,
  serializeInvalidationMessage,
  type InvalidationEntry,
} from './invalidation-message';

/**
 * A stand-in for one ioredis connection.
 *
 * Hand-written rather than a mocking library because the three behaviours that
 * matter here are behaviours of the *connection lifecycle* — a `ready` event
 * firing twice, a command rejecting, a channel being subscribed — and those are
 * clearer to arrange directly than through a mock of a client with a hundred
 * other methods.
 */
class FakeRedis {
  status = 'ready';
  readonly subscribed: string[] = [];
  readonly published: { channel: string; payload: string }[] = [];
  publishError: Error | null = null;
  subscribeError: Error | null = null;

  private readonly listeners = new Map<string, ((...args: never[]) => void)[]>();

  on(event: string, handler: (...args: never[]) => void): this {
    const existing = this.listeners.get(event);
    if (existing) existing.push(handler);
    else this.listeners.set(event, [handler]);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...(args as never[]));
    }
  }

  async subscribe(channel: string): Promise<number> {
    if (this.subscribeError) throw this.subscribeError;
    this.subscribed.push(channel);
    return 1;
  }

  async publish(channel: string, payload: string): Promise<number> {
    if (this.publishError) throw this.publishError;
    this.published.push({ channel, payload });
    return 1;
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  disconnect(): void {}
}

/** Lets the bus's un-awaited internal promises settle. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  bus: InvalidationBus;
  publisher: FakeRedis;
  subscriber: FakeRedis;
  configuration: ReturnType<typeof vi.fn>;
  providers: ReturnType<typeof vi.fn>;
}

async function harness(): Promise<Harness> {
  const publisher = new FakeRedis();
  const subscriber = new FakeRedis();
  const bus = new InvalidationBus(publisher as never, subscriber as never);

  const configuration = vi.fn();
  const providers = vi.fn();

  bus.subscribe(INVALIDATION_DOMAINS.CONFIGURATION, configuration as InvalidationHandler);
  bus.subscribe(INVALIDATION_DOMAINS.PROVIDERS, providers as InvalidationHandler);

  bus.onApplicationBootstrap();
  await settle();

  return { bus, publisher, subscriber, configuration, providers };
}

/** A message as some *other* process would have published it. */
function fromElsewhere(
  domain: (typeof INVALIDATION_DOMAINS)[keyof typeof INVALIDATION_DOMAINS],
  entry: InvalidationEntry | null,
): string {
  return serializeInvalidationMessage({
    v: INVALIDATION_PROTOCOL_VERSION,
    origin: 'some-other-process',
    domain,
    entry,
  });
}

describe('publishing', () => {
  it('stamps its own instance id so the echo can be ignored', async () => {
    const { bus, publisher } = await harness();

    await bus.publish(INVALIDATION_DOMAINS.CONFIGURATION, {
      key: 'rewards.hold_period_days',
      scope: 'GLOBAL',
      scopeId: '',
    });

    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.channel).toBe(INVALIDATION_CHANNEL);
    expect(JSON.parse(publisher.published[0]?.payload ?? '{}')).toMatchObject({
      origin: bus.instanceId,
      domain: 'configuration',
      entry: { key: 'rewards.hold_period_days' },
    });
  });

  it('gives every process a distinct instance id', () => {
    const one = new InvalidationBus(new FakeRedis() as never, new FakeRedis() as never);
    const two = new InvalidationBus(new FakeRedis() as never, new FakeRedis() as never);

    expect(one.instanceId).not.toBe(two.instanceId);
  });

  it('announces the domain wholesale once the connection recovers', async () => {
    /*
     * D64 — the mirror image of D61, and the one staleness scenario nothing
     * else covers.
     *
     * A publisher-only disconnect leaves every other process unaware that
     * anything happened: their subscriptions were never interrupted, so none of
     * them resyncs, and configuration has no periodic re-read to heal it. Only
     * the sender can notice, and this is where it does.
     */
    const { bus, publisher } = await harness();

    publisher.publishError = new Error('Stream isn’t writeable');
    await bus.publish(INVALIDATION_DOMAINS.CONFIGURATION, {
      key: 'rewards.hold_period_days',
      scope: 'GLOBAL',
      scopeId: '',
    });
    expect(publisher.published).toHaveLength(0);

    publisher.publishError = null;
    publisher.emit('ready');
    await settle();

    expect(publisher.published).toHaveLength(1);
    expect(JSON.parse(publisher.published[0]?.payload ?? '{}')).toMatchObject({
      domain: 'configuration',
      // Whole-domain, not the entry that was lost. A superset of whatever went
      // missing, and it needs no record of the individual changes — a record of
      // undelivered messages is a buffer, and a buffer is a message queue (D58).
      entry: null,
    });
  });

  it('announces nothing when nothing was lost', async () => {
    /*
     * The guard that keeps the recovery from being worse than the failure. A
     * publisher blip during a quiet period must not make every process on the
     * platform drop its caches.
     */
    const { publisher } = await harness();

    publisher.emit('ready');
    await settle();

    expect(publisher.published).toHaveLength(0);
  });

  it('announces only the domains that actually failed', async () => {
    const { bus, publisher } = await harness();

    publisher.publishError = new Error('Stream isn’t writeable');
    await bus.publish(INVALIDATION_DOMAINS.PROVIDERS, null);

    publisher.publishError = null;
    await bus.publish(INVALIDATION_DOMAINS.CONFIGURATION, {
      key: 'a.key',
      scope: 'GLOBAL',
      scopeId: '',
    });

    publisher.emit('ready');
    await settle();

    const announced = publisher.published
      .map((message) => JSON.parse(message.payload) as { domain: string; entry: unknown })
      .filter((message) => message.entry === null)
      .map((message) => message.domain);

    expect(announced).toEqual(['providers']);
  });

  it('retries the announcement if the connection goes again mid-recovery', async () => {
    const { bus, publisher } = await harness();

    publisher.publishError = new Error('Stream isn’t writeable');
    await bus.publish(INVALIDATION_DOMAINS.CONFIGURATION, null);

    // Recovery attempt that fails too — the domain must not be forgotten.
    publisher.emit('ready');
    await settle();
    expect(publisher.published).toHaveLength(0);

    publisher.publishError = null;
    publisher.emit('ready');
    await settle();

    expect(publisher.published).toHaveLength(1);
    expect(JSON.parse(publisher.published[0]?.payload ?? '{}')).toMatchObject({
      domain: 'configuration',
      entry: null,
    });
  });

  it('announces nothing once shutdown has begun', async () => {
    const { bus, publisher } = await harness();

    publisher.publishError = new Error('Stream isn’t writeable');
    await bus.publish(INVALIDATION_DOMAINS.CONFIGURATION, null);

    await bus.onApplicationShutdown();
    publisher.publishError = null;
    publisher.emit('ready');
    await settle();

    // The processes this would have told are about to outlive it; announcing
    // from a process that is going away is work nobody is waiting for.
    expect(publisher.published).toHaveLength(0);
  });

  it('does not throw when Redis is unreachable', async () => {
    /*
     * The caller has committed a database transaction and dropped its own
     * cache entry before it gets here. Throwing would report a change that
     * *did* happen as one that did not — and the notification is explicitly
     * optional (§14.4: cache failures degrade, never fail).
     */
    const { bus, publisher } = await harness();
    publisher.publishError = new Error('Stream isn’t writeable');

    await expect(
      bus.publish(INVALIDATION_DOMAINS.PROVIDERS, null),
    ).resolves.toBeUndefined();
  });
});

describe('receiving', () => {
  it('hands a keyed message to the domain that registered for it', async () => {
    const { subscriber, configuration, providers } = await harness();

    subscriber.emit(
      'message',
      INVALIDATION_CHANNEL,
      fromElsewhere(INVALIDATION_DOMAINS.CONFIGURATION, {
        key: 'offers.reward_share_percent',
        scope: 'GLOBAL',
        scopeId: '',
      }),
    );

    expect(configuration).toHaveBeenCalledWith({
      key: 'offers.reward_share_percent',
      scope: 'GLOBAL',
      scopeId: '',
    });
    expect(providers).not.toHaveBeenCalled();
  });

  it('passes null through for a domain with no key', async () => {
    const { subscriber, providers } = await harness();

    subscriber.emit(
      'message',
      INVALIDATION_CHANNEL,
      fromElsewhere(INVALIDATION_DOMAINS.PROVIDERS, null),
    );

    expect(providers).toHaveBeenCalledWith(null);
  });

  it('ignores its own echo', async () => {
    /*
     * The publisher dropped its entry locally *before* publishing. Acting on
     * the echo would mean a second registry reload — a database query — for a
     * change this process made itself.
     */
    const { bus, subscriber, configuration } = await harness();

    subscriber.emit(
      'message',
      INVALIDATION_CHANNEL,
      serializeInvalidationMessage({
        v: INVALIDATION_PROTOCOL_VERSION,
        origin: bus.instanceId,
        domain: INVALIDATION_DOMAINS.CONFIGURATION,
        entry: { key: 'a.key', scope: 'GLOBAL', scopeId: '' },
      }),
    );

    expect(configuration).not.toHaveBeenCalled();
  });

  it('ignores traffic on another channel', async () => {
    const { subscriber, configuration } = await harness();

    subscriber.emit(
      'message',
      'ow:1:something-else',
      fromElsewhere(INVALIDATION_DOMAINS.CONFIGURATION, {
        key: 'a.key',
        scope: 'GLOBAL',
        scopeId: '',
      }),
    );

    expect(configuration).not.toHaveBeenCalled();
  });

  it('drops every cache when it cannot read the message', async () => {
    /*
     * The rolling-deploy case. An unreadable message still means *something
     * changed*; dropping it would leave this process silently stale for the
     * length of the deploy. Every registered domain is told "everything".
     */
    const { subscriber, configuration, providers } = await harness();

    subscriber.emit('message', INVALIDATION_CHANNEL, '{"v":99,"garbage":true}');

    expect(configuration).toHaveBeenCalledWith(null);
    expect(providers).toHaveBeenCalledWith(null);
  });

  it('survives a handler that throws, and still runs the next one', async () => {
    const publisher = new FakeRedis();
    const subscriber = new FakeRedis();
    const bus = new InvalidationBus(publisher as never, subscriber as never);

    const exploding = vi.fn(() => {
      throw new Error('cache is on fire');
    });
    const other = vi.fn();

    bus.subscribe(INVALIDATION_DOMAINS.CONFIGURATION, exploding);
    bus.subscribe(INVALIDATION_DOMAINS.PROVIDERS, other);
    bus.onApplicationBootstrap();
    await settle();

    subscriber.emit('message', INVALIDATION_CHANNEL, '{"nonsense":true}');

    expect(exploding).toHaveBeenCalled();
    // Unrelated caches, no ordering between them: one failing must not leave
    // the other holding a stale value too.
    expect(other).toHaveBeenCalledWith(null);
  });

  it('does not leak an unhandled rejection from an async handler', async () => {
    const publisher = new FakeRedis();
    const subscriber = new FakeRedis();
    const bus = new InvalidationBus(publisher as never, subscriber as never);

    bus.subscribe(INVALIDATION_DOMAINS.PROVIDERS, async () => {
      throw new Error('the reload query failed');
    });
    bus.onApplicationBootstrap();
    await settle();

    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    subscriber.emit(
      'message',
      INVALIDATION_CHANNEL,
      fromElsewhere(INVALIDATION_DOMAINS.PROVIDERS, null),
    );
    await settle();

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('the connection lifecycle', () => {
  it('subscribes to the channel once it is ready', async () => {
    const { subscriber } = await harness();

    expect(subscriber.subscribed).toEqual([INVALIDATION_CHANNEL]);
  });

  it('does not resync on the first connection', async () => {
    // The cache is empty at boot; a resync would be a no-op that logs a
    // warning about a disconnect that never happened.
    const { configuration, providers } = await harness();

    expect(configuration).not.toHaveBeenCalled();
    expect(providers).not.toHaveBeenCalled();
  });

  it('drops every cache after a reconnect', async () => {
    /*
     * The single most important behaviour here. Redis pub/sub has no backlog:
     * a message published while this process was disconnected is gone, and
     * there is no sequence number to notice the gap with. So a subscriber that
     * comes back assumes it missed everything.
     *
     * Without this, a network blip lasting one second leaves a process serving
     * a value that changed during it — for as long as the process runs.
     */
    const { subscriber, configuration, providers } = await harness();

    subscriber.emit('ready');
    await settle();

    expect(configuration).toHaveBeenCalledWith(null);
    expect(providers).toHaveBeenCalledWith(null);
    expect(subscriber.subscribed).toEqual([INVALIDATION_CHANNEL, INVALIDATION_CHANNEL]);
  });

  it('starts even when Redis is unreachable', async () => {
    /*
     * §14.4: cache failures degrade, never fail. A boot that blocks on Redis
     * turns a blip into a deployment that cannot roll forward — and readiness
     * already reports Redis separately, so nobody is left guessing.
     */
    const publisher = new FakeRedis();
    const subscriber = new FakeRedis();
    subscriber.status = 'connecting';
    subscriber.subscribeError = new Error('connection refused');

    const bus = new InvalidationBus(publisher as never, subscriber as never);
    bus.subscribe(INVALIDATION_DOMAINS.CONFIGURATION, vi.fn());

    expect(() => bus.onApplicationBootstrap()).not.toThrow();
    await settle();

    expect(subscriber.subscribed).toEqual([]);
  });

  it('subscribes when a connection that failed at boot finally arrives', async () => {
    const publisher = new FakeRedis();
    const subscriber = new FakeRedis();
    subscriber.status = 'connecting';

    const bus = new InvalidationBus(publisher as never, subscriber as never);
    const configuration = vi.fn();
    bus.subscribe(INVALIDATION_DOMAINS.CONFIGURATION, configuration);
    bus.onApplicationBootstrap();
    await settle();

    expect(subscriber.subscribed).toEqual([]);

    subscriber.emit('ready');
    await settle();

    expect(subscriber.subscribed).toEqual([INVALIDATION_CHANNEL]);
    // Still the *first* subscription, so nothing was missed and nothing is
    // dropped — the cache was built after this process started, not before.
    expect(configuration).not.toHaveBeenCalled();
  });

  it('does not throw when a connection error arrives', async () => {
    /*
     * An `error` event with no listener terminates the process, so the
     * listener cannot simply be omitted — and ioredis re-emits it on every
     * reconnection attempt, so it must not be logged once per retry either.
     */
    const { subscriber, publisher } = await harness();

    expect(() => subscriber.emit('error', new Error('ECONNRESET'))).not.toThrow();
    expect(() => subscriber.emit('error', new Error('ECONNRESET'))).not.toThrow();
    expect(() => publisher.emit('error', new Error('ECONNRESET'))).not.toThrow();
  });

  it('stops resyncing once shutdown has begun', async () => {
    const { bus, subscriber, configuration } = await harness();

    await bus.onApplicationShutdown();
    subscriber.emit('ready');
    await settle();

    // A resync during shutdown would repopulate caches this process is about
    // to discard, against a database connection that may already be closing.
    expect(configuration).not.toHaveBeenCalled();
  });
});
