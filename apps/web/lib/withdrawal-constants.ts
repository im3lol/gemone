// Pure, client-safe constants + types (no server-only imports).
export type WithdrawalStatus =
  | "PENDING"
  | "APPROVED"
  | "PROCESSING"
  | "PAID"
  | "REJECTED"
  | "FAILED";

export type Withdrawal = {
  id: string;
  points: number;
  amountUsd: string;
  method: string;
  destination: string;
  status: WithdrawalStatus;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: string;
};

export const MIN_WITHDRAWAL_POINTS = 5000;

export const WITHDRAWAL_METHODS = [
  { value: "paypal", label: "PayPal" },
  { value: "amazon", label: "Amazon Gift Card" },
  { value: "visa", label: "Visa Gift Card" },
  { value: "googleplay", label: "Google Play" },
] as const;
