/**
 * The one Redis channel every process listens on — ARCHITECTURE.md §14.3.
 *
 * Named to §14.4's key convention, `ow:<schema-version>:<domain>:<identifier>`,
 * with the schema version carried in the channel rather than only in the
 * payload. Both are deliberate:
 *
 * - The **channel** version isolates an incompatible protocol change. A build
 *   that changes the message shape beyond what the parser can read publishes on
 *   `ow:2:…` and is simply not heard by `ow:1:…` listeners, instead of being
 *   heard and misread.
 * - The **payload** version (`INVALIDATION_PROTOCOL_VERSION`) covers the
 *   ordinary case — a field added within the same channel — which the parser
 *   handles by falling back to "invalidate everything" rather than guessing.
 *
 * One channel rather than one per domain. Subscribing is per-connection state
 * that has to be re-established on every reconnect, and a channel per domain
 * multiplies the ways a process can end up listening to some of them; the
 * domain is a field, which costs a comparison per message on a channel that
 * carries a few messages a week.
 */
export const INVALIDATION_CHANNEL = 'ow:1:invalidation';

/** The publishing connection. Separate from the subscriber — see the bus. */
export const INVALIDATION_PUBLISHER = Symbol('INVALIDATION_PUBLISHER');

/** The subscribing connection. */
export const INVALIDATION_SUBSCRIBER = Symbol('INVALIDATION_SUBSCRIBER');

/*
 * The names these two connections report to Redis.
 *
 * Redis's `CLIENT LIST` shows every connection a deployment holds, and a
 * process opens several — BullMQ's, the health probe's, and these two. Unnamed,
 * they are indistinguishable addresses, which matters at exactly the moment
 * somebody is trying to work out why a change did not propagate. Naming them
 * also makes the publisher's recovery path (D64) reproducible on demand:
 * `CLIENT KILL` can target the publisher alone, leaving every subscriber
 * connected, which is the failure this codebase could not otherwise stage.
 */
export const INVALIDATION_PUBLISHER_NAME = 'gemone:invalidation-publisher';
export const INVALIDATION_SUBSCRIBER_NAME = 'gemone:invalidation-subscriber';
