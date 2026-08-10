/**
 * The payout execution seam — ARCHITECTURE.md §11.4, P1.
 *
 * "Payout execution sits behind a `PayoutProvider` interface with exactly one
 * MVP implementation: `ManualPayoutProvider`, whose 'execution' is recording
 * what a human did. **One interface, one implementation, no factory** (P6)."
 *
 * ## Why the seam exists at all, given it has one implementation
 *
 * §11.4 states its present-tense justification precisely: *without it,
 * automating payouts later means editing the state machine — the part that is
 * hardest to change safely once real money has flowed through it.* The seam is
 * therefore not speculative generality; it is where an automated provider
 * attaches so that the state machine does not have to move.
 *
 * ## What is deliberately NOT here
 *
 * No factory, no registry, no slug-to-implementation map. The provider
 * *adapter* architecture (§7) has all three because networks are added
 * routinely; payout providers are not, and building the same machinery for a
 * set of size one would be the framework P1 explicitly does not authorise
 * ("P1/P2 authorize a seam, not a framework").
 */

/** What an execution needs to know. Money amounts, never points. */
export interface PayoutExecutionRequest {
  payoutId: string;
  userId: string;
  amountMinor: number;
  currency: string;
  method: string;
  /** Sensitive. An implementation must never log it (§16.4). */
  destination: string;

  /**
   * A reference a human already obtained, when there is one.
   *
   * The asymmetry the seam has to accommodate: an automated provider
   * *produces* a reference by sending money, while a manual one is *given* the
   * reference of money a person already sent. Optional rather than two
   * interfaces, because the caller and the state machine are identical either
   * way — which is the whole reason for having one interface.
   */
  externalReference?: string;
}

/**
 * The outcome of trying to send money.
 *
 * A result type rather than an exception, because "the payment failed" is a
 * business outcome the state machine has a state for (`FAILED`), not a fault.
 * An implementation that threw would make the caller translate an exception
 * back into a state, at the one call site where getting it wrong loses a
 * payment.
 */
export type PayoutExecutionResult =
  | { settled: true; externalReference: string }
  | { settled: false; reason: string };

export interface PayoutProvider {
  /** Identifies the implementation in logs and on the audit trail. */
  readonly name: string;

  /**
   * Whether this provider can send to the given method.
   *
   * Asked before execution so that "no provider handles this method" is a
   * refusal with a reason rather than a failed payment.
   */
  supports(method: string): boolean;

  /**
   * Executes — or records — a payment.
   *
   * Called **outside** the settling transaction. §10.2's first rule forbids
   * external I/O inside a transaction: an automated provider would hold the
   * balance row locked for the duration of somebody else's network latency,
   * and a lock held across a payment gateway call is a lock held across the
   * slowest thing in the system.
   */
  execute(request: PayoutExecutionRequest): Promise<PayoutExecutionResult>;
}

/** DI token. A symbol, so the interface stays an interface at runtime. */
export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');
