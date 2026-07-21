// Raised when a payout can never succeed (bad recipient, closed account) — the
// worker refunds immediately and does NOT retry. Any other thrown error is
// treated as transient and retried by BullMQ.
export class PermanentPayoutError extends Error {}

export type PayoutRequest = {
  withdrawalId: string;
  points: number;
  amountUsd: string;
  method: string;
  destination: string;
};

export interface PayoutProvider {
  readonly key: string;
  supports(method: string): boolean;
  pay(req: PayoutRequest): Promise<{ ref: string }>;
}
