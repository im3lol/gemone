import { Injectable } from '@nestjs/common';
import { PayoutProvider, PayoutRequest, PermanentPayoutError } from './payout-provider';

// ponytail: mock PayPal Payouts. Replace pay() with a real Payouts API call
// (create batch → poll status). Test hooks: a destination containing "fail"
// simulates a permanent rejection, "flaky" simulates a transient error.
@Injectable()
export class PaypalProvider implements PayoutProvider {
  readonly key = 'paypal';

  supports(method: string) {
    return method === 'paypal';
  }

  async pay(req: PayoutRequest): Promise<{ ref: string }> {
    if (req.destination.includes('fail')) {
      throw new PermanentPayoutError('PayPal: recipient cannot receive funds');
    }
    if (req.destination.includes('flaky')) {
      throw new Error('PayPal: temporary gateway error');
    }
    return { ref: `pp_${req.withdrawalId.slice(-8)}` };
  }
}
