import { z } from 'zod';

/**
 * The wire format of a cache-invalidation broadcast — ARCHITECTURE.md §14.3.
 *
 * This is an **internal** contract between our own processes, not an API shape,
 * so it lives here rather than in `packages/contracts`. Nothing outside the
 * deployment ever sees it, and putting it in the public contracts package would
 * invite a client to depend on it.
 */

/** The caches a message can be about. */
export const INVALIDATION_DOMAINS = {
  /** `ConfigurationService`'s in-process store of configuration rows. */
  CONFIGURATION: 'configuration',
  /** `ProviderRegistry`'s snapshot of provider rows and their adapters. */
  PROVIDERS: 'providers',
} as const;

export type InvalidationDomain =
  (typeof INVALIDATION_DOMAINS)[keyof typeof INVALIDATION_DOMAINS];

/** Bumped when the payload shape changes within the same channel. */
export const INVALIDATION_PROTOCOL_VERSION = 1;

/**
 * Which entry changed, for a domain that is keyed.
 *
 * Plain strings, not `ConfigScope`. The wire format deliberately does not
 * import the enum it describes: a receiver on an older build must be able to
 * *parse* a scope it does not recognise and hand it to a cache that will simply
 * not find it, rather than fail validation and lose the message entirely.
 */
const entrySchema = z.object({
  key: z.string().min(1),
  scope: z.string().min(1),
  /** Empty string for GLOBAL — the same sentinel the table uses. */
  scopeId: z.string(),
});

export type InvalidationEntry = z.infer<typeof entrySchema>;

const messageSchema = z.object({
  v: z.literal(INVALIDATION_PROTOCOL_VERSION),
  /**
   * The instance id of the process that published it.
   *
   * Present so a process can ignore its own broadcast. It has already dropped
   * the entry locally — that happens before publishing, not because of it — and
   * acting on the echo would mean a second registry reload, which is a database
   * query, for a change this process made.
   */
  origin: z.string().min(1),
  domain: z.enum([INVALIDATION_DOMAINS.CONFIGURATION, INVALIDATION_DOMAINS.PROVIDERS]),
  /**
   * The entry that changed, or **null for "everything in this domain"**.
   *
   * Null is not a degenerate case; it is how a domain with no key of its own
   * (the provider registry is one snapshot, not a map of independently
   * invalidatable rows) says anything at all.
   */
  entry: entrySchema.nullable(),
});

export type InvalidationMessage = z.infer<typeof messageSchema>;

/**
 * What a receiver got.
 *
 * `unintelligible` is a first-class outcome rather than an exception because
 * the receiver's correct response to it is *not* "ignore" — see
 * `parseInvalidationMessage`.
 */
export type ParsedInvalidation =
  | { status: 'ok'; message: InvalidationMessage }
  | { status: 'unintelligible'; reason: string };

export function serializeInvalidationMessage(message: InvalidationMessage): string {
  return JSON.stringify(message);
}

/**
 * Reads a broadcast, refusing to guess.
 *
 * ## Why an unreadable message must not be dropped
 *
 * The obvious handling — log it and move on — is wrong here, and the reason is
 * the rolling deploy. During one, a process on the old build receives messages
 * from processes on the new one. If the payload gained a field, or the protocol
 * version moved, every one of those messages is unreadable to the old process
 * — and every one of them means *a value it has cached just changed*. Dropping
 * them makes the old processes silently stale for the length of the deploy,
 * which is exactly the failure §14.3 exists to prevent, arriving at the one
 * moment nobody is watching for it.
 *
 * So the caller treats `unintelligible` as "something changed and I cannot tell
 * what": drop everything, in every domain. That is always safe (the next read
 * repopulates from the database) and it is never wrong, only occasionally
 * wasteful — the correct direction to be imprecise in.
 *
 * ARCHITECTURE.md §14.4's rule, applied to a message instead of a cached value:
 * typed on read, not trusted.
 */
export function parseInvalidationMessage(raw: string): ParsedInvalidation {
  let json: unknown;

  try {
    json = JSON.parse(raw);
  } catch {
    return { status: 'unintelligible', reason: 'not valid JSON' };
  }

  const parsed = messageSchema.safeParse(json);

  if (!parsed.success) {
    return {
      status: 'unintelligible',
      reason: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }

  return { status: 'ok', message: parsed.data };
}
