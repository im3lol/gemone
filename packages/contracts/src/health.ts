/**
 * Health endpoint contracts — ARCHITECTURE.md §17.2.
 *
 * Both responses are deliberately minimal: no version, no dependency names,
 * no error text. These endpoints sit on a public port, so diagnostic detail
 * belongs in logs, not in the response.
 */

/** `GET /health` — is the process alive? Checks nothing external. */
export interface LivenessResponse {
  status: 'ok';
}

/** `GET /health/ready` — can it serve traffic? */
export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
}
