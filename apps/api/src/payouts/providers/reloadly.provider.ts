import { Injectable } from '@nestjs/common';
import { PayoutProvider, PayoutRequest, PermanentPayoutError } from './payout-provider';

// ponytail: mock Reloadly gift-card payouts (Amazon / Visa / Google Play).
// Replace pay() with a real Reloadly order call.
@Injectable()
export class ReloadlyProvider implements PayoutProvider {
  readonly key = 'reloadly';
  private static readonly METHODS = new Set(['amazon', 'visa', 'googleplay']);

  supports(method: string) {
    return ReloadlyProvider.METHODS.has(method);
  }

  async pay(req: PayoutRequest): Promise<{ ref: string }> {
    if (req.destination.includes('fail')) {
      throw new PermanentPayoutError('Reloadly: card order rejected');
    }
    if (req.destination.includes('flaky')) {
      throw new Error('Reloadly: temporary error');
    }
    return { ref: `rl_${req.withdrawalId.slice(-8)}` };
  }
}
