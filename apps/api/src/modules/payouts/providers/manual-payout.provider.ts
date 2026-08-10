import { Injectable, Logger } from '@nestjs/common';

import type {
  PayoutExecutionRequest,
  PayoutExecutionResult,
  PayoutProvider,
} from '../contracts/payout-provider';

/**
 * The MVP's only payout provider — ARCHITECTURE.md §11.4.
 *
 * Its "execution" is **recording what a human did**. An admin has already sent
 * the money — by bank transfer, PayPal, or crypto, outside this system
 * entirely — and hands us the reference it produced.
 *
 * PROJECT.md §4.6 explains why this is the model rather than a stopgap:
 * payment-gateway integration is weeks of work and carries KYC, AML and
 * chargeback exposure, and at MVP volume an admin processes the queue by hand
 * in minutes a day.
 *
 * The class earns its existence by being the thing an automated provider
 * replaces. Everything the state machine does — approve, settle, refund — is
 * expressed against the interface, so an automated implementation changes this
 * file's neighbours and nothing else.
 */
@Injectable()
export class ManualPayoutProvider implements PayoutProvider {
  readonly name = 'manual';

  private readonly logger = new Logger(ManualPayoutProvider.name);

  /**
   * Every method, by construction.
   *
   * A human can send money by any means an admin has configured, which is
   * exactly why methods are configuration rather than code (§4.6). An
   * automated provider would answer this narrowly, which is the point of
   * asking at all.
   */
  supports(): boolean {
    return true;
  }

  /**
   * Records the payment an admin has already made.
   *
   * The reference is required by the caller before this is reached, so there
   * is no failure path here: a human either sent the money and has a reference,
   * or they did not and mark the request failed instead. An automated provider
   * is where `settled: false` starts being returned, and the state machine
   * already has somewhere to put it.
   *
   * **Nothing about the destination is logged.** It is a payment destination
   * (§16.4), and this is the one place in the system holding one at the moment
   * money moves.
   */
  async execute(request: PayoutExecutionRequest): Promise<PayoutExecutionResult> {
    const externalReference = request.externalReference?.trim() ?? '';

    if (externalReference.length === 0) {
      return { settled: false, reason: 'no external payment reference was recorded' };
    }

    this.logger.log(
      {
        payoutId: request.payoutId,
        method: request.method,
        amountMinor: request.amountMinor,
        currency: request.currency,
        provider: this.name,
      },
      'Manual payout recorded',
    );

    return { settled: true, externalReference };
  }
}
