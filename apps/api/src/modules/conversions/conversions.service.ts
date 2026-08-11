import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONVERSION_STATUSES,
  CONVERSION_TYPES,
  ERROR_CODES,
  FRAUD_ACTIONS,
  FRAUD_REVIEW_DECISIONS,
  POSTBACK_STATES,
  QUARANTINE_REASONS,
  REWARD_ACTOR_TYPES,
  REWARD_SOURCE_TYPES,
  REWARD_TRANSACTION_TYPES,
  type AdminConversionSummary,
  type AdminListConversionsQuery,
  type ConversionProcessingResult,
  type ConversionStatus,
  type FraudAction,
  type FraudEvaluationResult,
  type FraudReviewDecision,
  type Paginated,
  type QuarantineReason,
} from '@gemone/contracts';
import { v7 as uuidv7 } from 'uuid';

import {
  PrismaService,
  type PrismaTransactionClient,
} from '../../core/database/prisma.service';
import { DomainError, isAppError } from '../../core/errors/app-error';
import { CLOCK, type Clock } from '../../core/time/clock';
import type {
  Click,
  Conversion,
  Prisma,
  ProviderPostback,
  User,
} from '../../generated/prisma/client';
import { ClicksService } from '../clicks/clicks.service';
import { FraudService } from '../fraud/fraud.service';
import { RatesService, type RewardRates } from '../offers/rates.service';
import type { NormalizedConversion } from '../providers/contracts/normalized';
import { ProvidersService } from '../providers/providers.service';
import { ProviderRegistry } from '../providers/registry/provider-registry';
import { RewardAccountingService } from '../rewards/reward-accounting.service';
import { UsersService } from '../users/users.service';
import { FraudContextBuilder } from './fraud-context.builder';
import { toRawRequest } from './internal/postback-replay';
import { PostbackIntakeService } from './postback-intake.service';

/** Raised to stop processing and quarantine, carrying the reason. */
class Quarantine extends Error {
  constructor(readonly reason: QuarantineReason) {
    super(reason);
  }
}

/**
 * Turns an archived postback into a conversion — ARCHITECTURE.md §10.3.
 *
 * Owner of the `conversions` table (DATABASE.md §11), and the second half of
 * the `conversions` module: `PostbackIntakeService` decides whether to *accept*
 * a delivery, this decides what it *meant*.
 *
 * The whole design is the inversion of the intake surface. Intake is fast and
 * dumb because a provider is waiting on the socket; this is slow and careful
 * because nobody is. It runs on the worker, off the request path, and it is
 * allowed to take the queries it needs.
 *
 * **Three rules shape every branch here.**
 *
 *  1. **Nothing is ever silently dropped.** PROJECT.md §4.4: unmatched
 *     postbacks are quarantined for admin review. A silent drop is a user who
 *     completed an offer, was never paid, and about whom no record exists to
 *     argue with.
 *  2. **The archive is the input, not the job.** The payload is re-parsed from
 *     the row every time, so a parser bug is fixed by deploying and replaying
 *     rather than by asking providers to re-send events they consider
 *     delivered.
 *  3. **Idempotency is a constraint, not a check.** The `RECEIVED` test below
 *     is an optimisation; the unique index on `conversions.postback_id` is the
 *     guarantee. Two workers taking the same job both see it unprocessed.
 */
@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly postbacks: PostbackIntakeService,
    private readonly clicks: ClicksService,
    private readonly users: UsersService,
    private readonly providers: ProvidersService,
    private readonly registry: ProviderRegistry,
    private readonly rates: RatesService,
    private readonly rewards: RewardAccountingService,
    private readonly fraud: FraudService,
    private readonly fraudContext: FraudContextBuilder,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Processes one archived postback.
   *
   * Returns rather than throws for every *expected* outcome — a quarantine and
   * an already-processed row are both normal weather, and a job that throws on
   * them burns BullMQ retries on conditions no retry can change (§15.4).
   * Infrastructure failures still propagate, because those are the ones a
   * retry can fix.
   */
  async process(postbackId: string): Promise<ConversionProcessingResult> {
    const postback = await this.prisma.providerPostback.findUnique({
      where: { id: postbackId },
    });

    if (!postback) {
      /*
       * A job for a row that does not exist. Not retryable: no amount of
       * waiting makes it appear, and the only way here is a job outliving its
       * row — which a test database reset does routinely and production
       * should not.
       */
      this.logger.warn({ postbackId }, 'Postback job has no row; nothing to process');
      return skipped(postbackId);
    }

    if (postback.state !== POSTBACK_STATES.RECEIVED) {
      // Job-level idempotency (§10.3, step 1). Cheap, and deliberately not the
      // guarantee — see the class comment.
      return skipped(postbackId);
    }

    try {
      return await this.attribute(postback);
    } catch (error) {
      if (error instanceof Quarantine) {
        await this.postbacks.markQuarantined(postback.id, error.reason);

        /*
         * `warn`, not `error`. A conversion we cannot attribute is an
         * expected outcome on a public surface — an expired window, a
         * `sub_id` from before a secret rotation — and logging it as a fault
         * trains everyone to ignore the error log. It is visible where it
         * matters: the quarantine queue.
         */
        this.logger.warn(
          {
            postbackId: postback.id,
            providerId: postback.providerId,
            externalTransactionId: postback.externalTransactionId,
            reason: error.reason,
          },
          'Postback quarantined',
        );

        return {
          postbackId: postback.id,
          outcome: 'quarantined',
          conversionId: null,
          reason: error.reason,
        };
      }

      /*
       * Anything else is ours. The row is left where a replay finds it and the
       * error is re-thrown so BullMQ retries — this is the one case where a
       * retry can plausibly succeed.
       */
      await this.postbacks
        .markFailed(postback.id, describeFailure(error))
        .catch(() => undefined);

      throw error;
    }
  }

  // --- The pipeline ---------------------------------------------------------

  private async attribute(
    postback: ProviderPostback,
  ): Promise<ConversionProcessingResult> {
    const parsed = await this.reparse(postback);
    const click = await this.resolveClick(parsed.subId);

    if (click.providerId !== postback.providerId) {
      /*
       * One provider reporting a conversion against another provider's click.
       *
       * A `sub_id` is unguessable, so this is far more likely to be an
       * integration mistake than an attack — but it is exactly the shape an
       * attack would take, and crediting it would pay one network's user out
       * of another network's event.
       */
      throw new Quarantine(QUARANTINE_REASONS.PROVIDER_MISMATCH);
    }

    const rates = await this.rates.resolve(postback.providerId);

    if (parsed.payoutCurrency !== rates.accountingCurrency) {
      /*
       * Applying a rate calibrated for one currency to another is silently
       * wrong by whatever the exchange rate happens to be, and invisible — the
       * conversion looks fine, it just pays the wrong amount forever. The
       * catalog refuses such offers at sync time for the same reason; this is
       * the same refusal one layer down, where it needs a human because the
       * user has already done the work.
       */
      throw new Quarantine(QUARANTINE_REASONS.CURRENCY_MISMATCH);
    }

    const user = await this.users.findById(click.userId);
    if (!user) throw new Quarantine(QUARANTINE_REASONS.CLICK_NOT_FOUND);

    const reversalOf = parsed.isReversal ? await this.findReversalTarget(click, parsed) : null;

    /*
     * §10.3 step 4 — scoring, before crediting and not blocking it.
     *
     * Skipped for reversals: a chargeback grants nothing, so there is no
     * decision for a score to inform, and scoring it would file an evaluation
     * against a user for an event the provider initiated.
     */
    const scoring = reversalOf ? null : await this.score(user, click, postback, parsed);

    const { status, reviewReason } = resolveStatus(
      parsed,
      UsersService.isActive(user),
      scoring?.result.action ?? null,
      scoring?.reason ?? null,
    );

    const conversion = await this.persist({
      postback,
      click,
      parsed,
      rates,
      status,
      reviewReason,
      reversalOf,
      scoring,
    });

    this.logger.log(
      {
        conversionId: conversion.id,
        postbackId: postback.id,
        userId: click.userId,
        clickId: click.id,
        type: conversion.type,
        status: conversion.status,
        rewardPoints: conversion.rewardPoints,
      },
      'Conversion recorded',
    );

    return {
      postbackId: postback.id,
      outcome: 'converted',
      conversionId: conversion.id,
      reason: null,
    };
  }

  /**
   * Scores a conversion and reduces the result to what the pipeline needs.
   *
   * **Failure here never fails the job.** A scoring engine that cannot run is a
   * missing opinion, not a reason to refuse a conversion the user has already
   * earned — and the alternative, retrying the postback, would eventually
   * quarantine a legitimate event because a configuration read timed out. The
   * conversion proceeds unscored and the gap is logged at `error`, which is
   * §17.1's level for "a thing that should have happened did not".
   */
  private async score(
    user: User,
    click: Click,
    postback: ProviderPostback,
    parsed: NormalizedConversion,
  ): Promise<Scoring | null> {
    try {
      const context = await this.fraudContext.build({
        user,
        click,
        providerId: postback.providerId,
        occurredAt: parsed.occurredAt ?? this.clock.now(),
        now: this.clock.now(),
      });

      const result = await this.fraud.evaluate(context);

      return {
        result,
        reason:
          result.triggered.length > 0
            ? result.triggered.map((rule) => rule.detail).join('; ')
            : null,
      };
    } catch (error) {
      this.logger.error(
        { postbackId: postback.id, userId: user.id, err: describeFailure(error) },
        'Fraud scoring failed; the conversion proceeds unscored',
      );

      return null;
    }
  }

  /**
   * Re-reads the archived payload through the provider's adapter.
   *
   * Resolves the adapter through the registry, and **reloads the registry once
   * if the slug is unknown**. The worker holds an in-memory snapshot taken at
   * boot (§7.3), so a provider enabled afterwards is invisible to it — the same
   * trap the scheduled catalog path documents in D14.
   *
   * Reloaded *on miss* rather than before every job, unlike the catalog tick:
   * this is the highest-volume queue there will be, and an unconditional read
   * of the provider table per postback is a query per conversion for a table
   * that changes a few times a week.
   */
  private async reparse(postback: ProviderPostback): Promise<NormalizedConversion> {
    const provider = await this.providers.findById(postback.providerId);
    if (!provider) throw new Quarantine(QUARANTINE_REASONS.PROVIDER_UNAVAILABLE);

    let registered = this.registry.find(provider.slug);

    if (!registered) {
      await this.providers.reload();
      registered = this.registry.find(provider.slug);
    }

    if (!registered) {
      /*
       * Quarantined rather than failed. The payload cannot be read by this
       * build at all, so retrying is pointless until somebody deploys or fixes
       * the environment — and the row must stay visible until they do.
       *
       * Note that a *disabled* provider still processes. Disabling stops new
       * postbacks being accepted (§7.3); refusing to process what was already
       * accepted would strand conversions users had legitimately earned before
       * the switch was flipped.
       */
      throw new Quarantine(QUARANTINE_REASONS.PROVIDER_UNAVAILABLE);
    }

    try {
      return registered.adapter.parsePostback(
        toRawRequest({
          payload: postback.payload,
          headers: postback.headers,
          sourceIp: postback.sourceIp,
        }),
      );
    } catch {
      // It parsed at intake and does not now, so the adapter changed under it.
      // Quarantine keeps the row replayable once the adapter is fixed.
      throw new Quarantine(QUARANTINE_REASONS.PAYLOAD_UNREADABLE);
    }
  }

  /**
   * `sub_id` → click, with the attribution window enforced.
   *
   * `ClicksService` owns all three failure modes and distinguishes them (§11.2,
   * §5 rule 3 — `conversions` never reads the `clicks` table). Each maps to its
   * own quarantine reason, because "we never issued this" and "you are three
   * days late" call for completely different conversations with a provider.
   */
  private async resolveClick(subId: string): Promise<Click> {
    try {
      return await this.clicks.resolveSubId(subId);
    } catch (error) {
      if (!isAppError(error)) throw error;

      switch (error.code) {
        case ERROR_CODES.CLICK_SUB_ID_INVALID:
          throw new Quarantine(QUARANTINE_REASONS.SUB_ID_INVALID);
        case ERROR_CODES.CLICK_NOT_FOUND:
          throw new Quarantine(QUARANTINE_REASONS.CLICK_NOT_FOUND);
        case ERROR_CODES.CLICK_ATTRIBUTION_EXPIRED:
          throw new Quarantine(QUARANTINE_REASONS.ATTRIBUTION_EXPIRED);
        default:
          throw error;
      }
    }
  }

  /**
   * Which conversion a chargeback takes back.
   *
   * The adapter contract carries `isReversal` but no reference to the original
   * (§7.1), because the networks this was modelled on do not send one — they
   * re-send the `sub_id` with a new transaction id. So the original is found by
   * click, narrowed by the amount being taken back.
   *
   * **Ambiguity is quarantined, never guessed.** A multi-step offer produces
   * several conversions on one click; picking "the most recent" would reverse
   * whichever happened to sort first and be wrong silently, in money. A human
   * resolving one reversal is cheaper than a rule that is wrong in a way nobody
   * can see (TODO T24).
   */
  private async findReversalTarget(
    click: Click,
    parsed: NormalizedConversion,
  ): Promise<Conversion> {
    const candidates = await this.prisma.conversion.findMany({
      where: {
        clickId: click.id,
        type: CONVERSION_TYPES.CONVERSION,
        status: { not: CONVERSION_STATUSES.REVERSED },
        payoutAmountMinor: parsed.payoutAmountMinor,
        payoutCurrency: parsed.payoutCurrency,
      },
    });

    if (candidates.length === 0) {
      // §10.3: "A reversal for a conversion we never saw is quarantined, not
      // ignored." Ignoring it would leave credited points nobody can explain.
      throw new Quarantine(QUARANTINE_REASONS.REVERSAL_ORIGINAL_NOT_FOUND);
    }

    if (candidates.length > 1) {
      throw new Quarantine(QUARANTINE_REASONS.REVERSAL_AMBIGUOUS);
    }

    return candidates[0]!;
  }

  /**
   * The transaction — DATABASE.md §10.1.
   *
   * "Create conversion → credit reward → mark postback processed. **The
   * critical one. Partial completion here is a missing or duplicated
   * credit.**" All three commit together or none of them do.
   *
   * A chargeback has the same shape: create reversal → reverse reward → mark
   * the original reversed, so a reversal row can never exist without both its
   * target having been updated and the points having actually moved back.
   *
   * **The balance row is locked first** (§10.2, rule 3). That is why the
   * conversion id is generated before the transaction opens rather than being
   * read back from the insert: the reward movement has to reference the
   * conversion, and the conversion insert must not precede the balance lock. A
   * consistent lock order across every path is what prevents deadlocks.
   *
   * Everything the transaction needs — the parse, the click, the rates, the
   * user — was resolved before it opened (§10.2, rule 1: no external I/O
   * inside, and no configuration read holding a lock open).
   */
  private async persist(input: {
    postback: ProviderPostback;
    click: Click;
    parsed: NormalizedConversion;
    rates: RewardRates;
    status: ConversionStatus;
    reviewReason: string | null;
    reversalOf: Conversion | null;
    scoring: Scoring | null;
  }): Promise<Conversion> {
    const { postback, click, parsed, rates, reversalOf, scoring } = input;

    const rewardPoints = RatesService.pointsFor(parsed.payoutAmountMinor, rates);
    const now = this.clock.now();
    const conversionId = uuidv7();

    /*
     * Resolved before the transaction opens, never inside it (§10.2, rule 4).
     * A configuration read holding the balance lock open would extend the
     * window during which every other credit for this user waits.
     */
    const creditPlan = this.planCredit(input.status, rewardPoints, reversalOf !== null);

    /*
     * A conversion whose points actually moved is `CREDITED`, not
     * `ATTRIBUTED`. The distinction is the one D31 draws: `ATTRIBUTED` means
     * matched and priced with **no balance effect applied**, which stopped
     * being true of the happy path the moment crediting landed inside this
     * transaction. It still describes a reversal row and a conversion worth
     * zero points — both recorded, neither moving anything.
     *
     * A held conversion stays `HELD`: its points exist and are visible, and it
     * is precisely the fact that they were *not* released that the status has
     * to carry.
     */
    const storedStatus =
      creditPlan.credits && !creditPlan.holdIndefinitely
        ? CONVERSION_STATUSES.CREDITED
        : input.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        /*
         * The evidence commits with the conversion it explains.
         *
         * Written first because the conversion carries the reference (D47),
         * and inside the transaction because a held conversion whose
         * evaluation rolled back is a hold nobody can explain — which is the
         * one thing DATABASE.md §3.6 says this table exists to prevent.
         *
         * The applied action is recorded separately from the recommended one:
         * a provider-pending conversion credits nothing whatever the score, so
         * a HOLD recommendation legitimately lands as ALLOW.
         */
        const evaluation = scoring
          ? await this.fraud.record(
              {
                userId: click.userId,
                result: scoring.result,
                appliedAction: appliedActionOf(scoring.result.action, creditPlan, storedStatus),
              },
              tx,
            )
          : null;

        if (creditPlan.credits) {
          /*
           * §10.3 step 6, and P2: the points move through
           * `RewardAccountingService` and through nothing else. This module
           * has never seen a balance row and cannot — `arch.spec.ts` fails the
           * build if it tries.
           */
          await this.rewards.credit(
            {
              userId: click.userId,
              amountPoints: rewardPoints,
              /*
               * The title comes from the click's snapshot, not from the offer
               * row: the offer will be overwritten by the next catalog sync,
               * and a statement line must say what the user was actually shown
               * when they clicked. It is the same value, frozen at the same
               * moment, as the promise this conversion is settling.
               */
              source: {
                type: REWARD_SOURCE_TYPES.CONVERSION,
                id: conversionId,
                label: click.offerTitleSnapshot,
              },
              holdScopeProviderId: postback.providerId,
              /*
               * A held conversion is credited and never matures (§10.3 step 7):
               * the points exist, they are visible as pending, and no clock
               * will make them withdrawable. Points are held rather than
               * refused because a false positive that holds is recoverable and
               * one that refuses is not.
               */
              holdIndefinitely: creditPlan.holdIndefinitely,
              reason: creditPlan.reason,
            },
            tx,
          );
        }

        if (reversalOf) {
          await this.reverseRewardFor(reversalOf, conversionId, tx);
        }

        const conversion = await tx.conversion.create({
          data: {
            id: conversionId,
            clickId: click.id,
            userId: click.userId,
            providerId: postback.providerId,
            offerId: click.offerId,
            postbackId: postback.id,

            type: reversalOf ? CONVERSION_TYPES.REVERSAL : CONVERSION_TYPES.CONVERSION,
            status: storedStatus,

            externalTransactionId: parsed.externalTransactionId,
            externalOfferId: parsed.externalOfferId,
            payoutAmountMinor: parsed.payoutAmountMinor,
            payoutCurrency: parsed.payoutCurrency,
            providerStatus: parsed.status,
            occurredAt: parsed.occurredAt,

            rewardPoints,
            pointsPerMinorUnit: rates.pointsPerMinorUnit,
            rewardSharePercent: rates.rewardSharePercent,

            reversalOfId: reversalOf?.id ?? null,
            reviewReason: input.reviewReason,
            fraudEvaluationId: evaluation?.id ?? null,

            createdAt: now,
          },
        });

        if (reversalOf) {
          await tx.conversion.update({
            where: { id: reversalOf.id },
            data: { status: CONVERSION_STATUSES.REVERSED },
          });
        }

        await this.postbacks.markProcessed(postback.id, tx);

        return conversion;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        /*
         * Another worker processed this postback while we were working on it.
         *
         * The `RECEIVED` check at the top is not a lock, so both see the row
         * unprocessed; the unique index on `postback_id` is what decides. The
         * loser reads the winner's row and reports it — an error here would
         * fail a job whose work is done, and the retry would lose the same
         * race again.
         */
        const existing = await this.prisma.conversion.findUnique({
          where: { postbackId: postback.id },
        });

        if (existing) return existing;
      }

      throw error;
    }
  }

  private planCredit(
    status: ConversionStatus,
    rewardPoints: number,
    isReversal: boolean,
  ): CreditPlan {
    return planCredit(status, rewardPoints, isReversal);
  }

  /**
   * Takes back the points an earlier conversion credited.
   *
   * The credit is found through `RewardAccountingService`, by the source
   * reference it was written with. This module does not know how a reward
   * movement is stored and could not query one if it wanted to (P2) — which is
   * why the lookup is a service call rather than a join.
   *
   * A conversion that was never credited — provider-pending, provider-rejected,
   * or worth zero points — has nothing to reverse. That is not an error: the
   * reversal is still recorded as a conversion row, because the provider did
   * tell us something happened and the record of that must exist.
   */
  private async reverseRewardFor(
    original: Conversion,
    reversalConversionId: string,
    tx: PrismaTransactionClient,
  ): Promise<void> {
    const credit = await this.rewards.findBySource(
      REWARD_SOURCE_TYPES.CONVERSION,
      original.id,
      REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
    );

    if (!credit) {
      this.logger.log(
        { conversionId: original.id, status: original.status },
        'Reversed conversion had no credit to take back',
      );
      return;
    }

    await this.rewards.reverse(
      credit.id,
      'provider reported a chargeback',
      {
        // No label of its own: a reversal conversion is the same offer seen
        // again, so `reverse` copies the credit's and the two lines read as
        // one story.
        source: { type: REWARD_SOURCE_TYPES.CONVERSION, id: reversalConversionId },
      },
      tx,
    );
  }

  // --- Reads ----------------------------------------------------------------

  async findMany(query: AdminListConversionsQuery): Promise<Paginated<Conversion>> {
    const limit = clampLimit(query.limit);
    const offset = Math.max(0, query.offset ?? 0);

    const where: Prisma.ConversionWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.clickId ? { clickId: query.clickId } : {}),
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(query.offerId ? { offerId: query.offerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.externalTransactionId
        ? { externalTransactionId: query.externalTransactionId }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.conversion.findMany({
        where,
        orderBy: { createdAt: query.order ?? 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.conversion.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  async requireById(id: string): Promise<Conversion> {
    const conversion = await this.prisma.conversion.findUnique({ where: { id } });

    if (!conversion) {
      throw new DomainError(ERROR_CODES.CONVERSION_NOT_FOUND, 'Conversion not found', 404, {
        id,
      });
    }

    return conversion;
  }

  /** The conversion one postback produced, if it produced one. */
  async findByPostbackId(postbackId: string): Promise<Conversion | null> {
    return this.prisma.conversion.findUnique({ where: { postbackId } });
  }

  /**
   * The conversion an evaluation explains, if one followed it.
   *
   * The link is stored on this side (D47), so `fraud` cannot resolve it and
   * does not try — it has no reference to the conversion at all. This is the
   * lookup that keeps that true while an admin screen still shows both.
   */
  async findByFraudEvaluationId(fraudEvaluationId: string): Promise<Conversion | null> {
    return this.prisma.conversion.findUnique({ where: { fraudEvaluationId } });
  }

  // --- Review ---------------------------------------------------------------

  /**
   * Resolves a held conversion — the decision T29 said was missing.
   *
   * *"A conversion held for review credits points that never mature (D39).
   * Nothing can currently clear one, so those points are stranded —
   * deliberately, since the accounts producing them are not active, but
   * permanently, which is not the design."* Fraud makes that queue real, so the
   * way out of it ships with the thing that fills it.
   *
   * Takes a transaction client because `admin` opens the transaction: the
   * status change, the balance movement and the audit entry are one atomic
   * decision, and `admin` owns the audit log (D44, the same shape as the payout
   * transitions).
   *
   * **The points move through `RewardAccountingService` and nowhere else.**
   * This method decides *what* happens; `credit`, `mature` and `reverse` are
   * still the only things that touch a balance (P2).
   */
  async resolveHold(
    tx: PrismaTransactionClient,
    input: {
      conversionId: string;
      decision: FraudReviewDecision;
      reason: string;
      adminId: string;
      now: Date;
    },
  ): Promise<Conversion> {
    /*
     * Re-read and locked inside the transaction.
     *
     * Two admins clearing the same hold in the same second both read `HELD`
     * outside a transaction and both pass the check — and the second would
     * mature a credit that the first already matured. The row lock is what
     * makes the status check mean something, exactly as it does for a payout
     * transition.
     */
    const rows = await tx.$queryRaw<
      { id: string; status: string }[]
    >`SELECT id, status FROM conversions WHERE id = ${input.conversionId}::uuid FOR UPDATE`;

    const locked = rows[0];

    if (!locked) {
      throw new DomainError(ERROR_CODES.CONVERSION_NOT_FOUND, 'Conversion not found', 404, {
        conversionId: input.conversionId,
      });
    }

    if (locked.status !== CONVERSION_STATUSES.HELD) {
      throw new DomainError(
        ERROR_CODES.FRAUD_CONVERSION_NOT_HELD,
        `This conversion is ${locked.status.toLowerCase()} and has no hold to resolve`,
        409,
        { conversionId: input.conversionId, status: locked.status },
      );
    }

    /*
     * The credit this hold is withholding.
     *
     * Found through the accounting service by source reference, not by a join.
     * Ledger storage belongs to `rewards` and this module has never read it
     * (P2, enforced by `arch.spec.ts` — which is what caught the first draft of
     * this very comment).
     */
    const credit = await this.rewards.findBySource(
      REWARD_SOURCE_TYPES.CONVERSION,
      input.conversionId,
      REWARD_TRANSACTION_TYPES.CONVERSION_CREDIT,
    );

    if (input.decision === FRAUD_REVIEW_DECISIONS.CLEAR) {
      /*
       * Not fraud. The held points mature and become withdrawable.
       *
       * `mature` is idempotent by construction — it refuses a credit something
       * has already acted on — so the loser of a race that got past the lock
       * still cannot release the same points twice.
       */
      if (credit) {
        await this.rewards.mature(credit.id, tx);
      }

      return tx.conversion.update({
        where: { id: input.conversionId },
        data: {
          status: CONVERSION_STATUSES.CREDITED,
          reviewReason: input.reason,
          reviewedByAdminId: input.adminId,
          reviewedAt: input.now,
        },
      });
    }

    /*
     * Fraud confirmed. The credit is reversed and the points leave the balance.
     *
     * `REJECTED` rather than `REVERSED`: `REVERSED` is the status a chargeback
     * writes on the conversion it points at, and there is no reversal row here
     * — the provider never disputed anything, a reviewer did. See D50.
     */
    if (credit) {
      await this.rewards.reverse(
        credit.id,
        input.reason,
        { actor: { type: REWARD_ACTOR_TYPES.ADMIN, id: input.adminId } },
        tx,
      );
    }

    return tx.conversion.update({
      where: { id: input.conversionId },
      data: {
        status: CONVERSION_STATUSES.REJECTED,
        reviewReason: input.reason,
        reviewedByAdminId: input.adminId,
        reviewedAt: input.now,
      },
    });
  }

  // --- Serialisation --------------------------------------------------------

  toAdminSummary(conversion: Conversion, providerSlug: string): AdminConversionSummary {
    return {
      id: conversion.id,
      type: conversion.type,
      status: conversion.status,

      clickId: conversion.clickId,
      userId: conversion.userId,
      providerId: conversion.providerId,
      providerSlug,
      offerId: conversion.offerId,
      postbackId: conversion.postbackId,

      externalTransactionId: conversion.externalTransactionId,
      externalOfferId: conversion.externalOfferId,
      payoutAmountMinor: conversion.payoutAmountMinor,
      payoutCurrency: conversion.payoutCurrency,
      providerStatus: conversion.providerStatus,
      occurredAt: conversion.occurredAt?.toISOString() ?? null,

      rewardPoints: conversion.rewardPoints,
      pointsPerMinorUnit: conversion.pointsPerMinorUnit,
      rewardSharePercent: conversion.rewardSharePercent,

      reversalOfId: conversion.reversalOfId,
      reviewReason: conversion.reviewReason,

      createdAt: conversion.createdAt.toISOString(),
      updatedAt: conversion.updatedAt.toISOString(),
    };
  }
}

/**
 * What the provider said, plus what we know about the account, becomes one
 * status.
 *
 * The account check is §10.3 step 3 — "load user; if banned, flagged for
 * review, no credit" — and it is deliberately *not* fraud scoring, which is a
 * separate step and a separate module. It is one condition with one answer.
 *
 * It holds for any account that is not active, not only a banned one. Holding
 * is the recoverable direction: a held conversion an admin clears costs a
 * delay, a refused one costs a record that no longer exists (§10.3).
 */
function resolveStatus(
  parsed: NormalizedConversion,
  userIsActive: boolean,
  fraudAction: FraudAction | null,
  fraudReason: string | null,
): { status: ConversionStatus; reviewReason: string | null } {
  if (parsed.status === 'rejected') {
    // The provider refused it. It never earned anything, and holding it for
    // review would put a decision in front of an admin that is not theirs.
    return {
      status: CONVERSION_STATUSES.REJECTED,
      reviewReason: 'the provider reported this conversion as rejected',
    };
  }

  if (parsed.status === 'pending') {
    // Recorded, priced, and not creditable. Some networks report an install
    // the moment it happens and confirm it days later.
    return { status: CONVERSION_STATUSES.PENDING, reviewReason: null };
  }

  if (!userIsActive) {
    return {
      status: CONVERSION_STATUSES.HELD,
      reviewReason: 'the account was not active when this conversion arrived',
    };
  }

  if (fraudAction === FRAUD_ACTIONS.BLOCK) {
    /*
     * The one action that refuses rather than delays.
     *
     * Nothing in the shipped rule set defaults to it (fraud.config.ts) — it
     * exists so an admin can configure a rule up to it once they have evidence
     * that a signal is conclusive, not so this code can choose it. `REJECTED`
     * rather than `HELD` because there is no decision left for a human: the
     * conversion is recorded, and it earns nothing.
     */
    return {
      status: CONVERSION_STATUSES.REJECTED,
      reviewReason: fraudReason ?? 'blocked by a fraud rule',
    };
  }

  if (fraudAction === FRAUD_ACTIONS.HOLD || fraudAction === FRAUD_ACTIONS.REVIEW) {
    /*
     * Both hold the points; they differ in what an admin is being asked to
     * look at (the conversion, or the account behind it). The distinction is
     * carried on the evaluation, which the review screen reads — flattening it
     * into two conversion statuses would put fraud vocabulary into a status
     * enum owned by this module.
     */
    return {
      status: CONVERSION_STATUSES.HELD,
      reviewReason: fraudReason ?? 'held for review by a fraud rule',
    };
  }

  return { status: CONVERSION_STATUSES.ATTRIBUTED, reviewReason: null };
}

/** A completed scoring pass, reduced to what the pipeline uses. */
interface Scoring {
  result: FraudEvaluationResult;
  /** The triggered rules' details, joined — or null when nothing fired. */
  reason: string | null;
}

/**
 * What the pipeline *did*, as opposed to what the engine recommended.
 *
 * DATABASE.md §3.6 asks for both, and they diverge in ways that matter when
 * reading a stored evaluation back:
 *
 *  - A provider-`pending` or provider-`rejected` conversion credits nothing
 *    whatever the score, so a `HOLD` recommendation was not acted on.
 *  - An inactive account is already held for a reason that has nothing to do
 *    with fraud, so an `ALLOW` recommendation still ended in a hold.
 *
 * Recording only the recommendation would leave both looking like the engine
 * decided something it did not.
 */
function appliedActionOf(
  recommended: FraudAction,
  plan: CreditPlan,
  storedStatus: ConversionStatus,
): FraudAction {
  if (storedStatus === CONVERSION_STATUSES.REJECTED) {
    return recommended === FRAUD_ACTIONS.BLOCK ? FRAUD_ACTIONS.BLOCK : FRAUD_ACTIONS.ALLOW;
  }

  if (!plan.credits) {
    // Nothing moved, so nothing was withheld. Whatever the engine wanted, the
    // outcome for this user's balance was indistinguishable from ALLOW.
    return FRAUD_ACTIONS.ALLOW;
  }

  if (plan.holdIndefinitely) {
    // Held. `REVIEW` is a stronger statement than `HOLD` and survives; an
    // `ALLOW` that ended up held was held by something else.
    return recommended === FRAUD_ACTIONS.REVIEW ? FRAUD_ACTIONS.REVIEW : FRAUD_ACTIONS.HOLD;
  }

  return FRAUD_ACTIONS.ALLOW;
}

/** What a conversion does to a balance, decided before any transaction opens. */
interface CreditPlan {
  credits: boolean;
  holdIndefinitely: boolean;
  reason: string;
}

/**
 * Which conversions move points, and which only record that something happened.
 *
 * A pure function, deliberately outside the class: the branch nobody wants to
 * discover is wrong is the one deciding whether a user gets paid, and it should
 * be exercisable without a database, a queue or a provider.
 */
function planCredit(
  status: ConversionStatus,
  rewardPoints: number,
  isReversal: boolean,
): CreditPlan {
  if (isReversal) {
    /*
     * A chargeback takes points back; it never grants any.
     *
     * Its own status is `ATTRIBUTED` — it *is* matched and priced, and its
     * `reward_points` records what is being taken back — so a plan that read
     * only the status would credit the reversal and then reverse the original,
     * leaving the user holding exactly the points the chargeback existed to
     * remove. Found by the end-to-end test and by nothing smaller, which is
     * why that test spans the whole chain.
     */
    return { credits: false, holdIndefinitely: false, reason: '' };
  }

  if (rewardPoints <= 0) {
    // Zero points is not a small credit, it is a movement with no meaning. It
    // would put a line on the user's statement saying nothing happened.
    return { credits: false, holdIndefinitely: false, reason: '' };
  }

  switch (status) {
    case CONVERSION_STATUSES.ATTRIBUTED:
      return { credits: true, holdIndefinitely: false, reason: 'conversion attributed' };

    case CONVERSION_STATUSES.HELD:
      // Credited and never matured (§10.3 step 7): the points exist and are
      // visible as pending, and no clock will make them withdrawable.
      return { credits: true, holdIndefinitely: true, reason: 'conversion held for review' };

    /*
     * A provider-pending event has not been confirmed, and a provider-rejected
     * one never will be. Neither is owed anything, so neither produces a
     * movement — the conversion row records that we heard about it, which is a
     * different fact.
     */
    default:
      return { credits: false, holdIndefinitely: false, reason: '' };
  }
}

function skipped(postbackId: string): ConversionProcessingResult {
  return { postbackId, outcome: 'skipped', conversionId: null, reason: null };
}

/** Narrow, for the same reason intake's is: a broad catch hides an outage. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'P2002';
}

/** One line, safe to store and to show an admin. Never a stack trace (§15.3). */
function describeFailure(error: unknown): string {
  if (isAppError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message.replaceAll(/\s+/g, ' ').slice(0, 500);
  return String(error).slice(0, 500);
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, requested), MAX_LIMIT);
}

export const __testing = {
  resolveStatus,
  planCredit,
  isUniqueViolation,
  describeFailure,
  clampLimit,
  Quarantine,
};
