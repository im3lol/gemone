/**
 * The Redis connection the login throttle counts on.
 *
 * Its own, rather than the `REDIS_CONNECTION` `QueueModule` exports, for the
 * reason `EventsModule` gives for owning its pair: that connection is
 * configured for a health probe, and a connection's retry settings should
 * answer to the job it actually does. This one's job is a control that fails
 * closed (§15.4), so it is configured never to queue a command it cannot send —
 * a counter read that waits in memory for Redis to come back is a login that
 * hangs instead of being refused.
 */
export const LOGIN_THROTTLE_REDIS = Symbol('LOGIN_THROTTLE_REDIS');
