import {
  ERROR_CODES,
  FRAUD_ACTIONS,
  FRAUD_RULES,
  type AdminFraudEvaluationDetail,
  type AdminFraudEvaluationSummary,
  type FraudAction,
  type FraudEvaluationResult,
  type FraudRuleId,
  type FraudRuleSnapshot,
  type TriggeredRule,
  type UserFraudSignals,
} from '@gemone/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { ConfigurationService } from '../../core/config/configuration.service';
import { PrismaService, type PrismaTransactionClient } from '../../core/database/prisma.service';
import { DomainError } from '../../core/errors/app-error';
import type { FraudEvaluation, Prisma } from '../../generated/prisma/client';
import type { FraudEvaluationContext } from './contracts/fraud-context';
import {
  FRAUD_CHARGEBACK_MINIMUM_CONVERSIONS,
  FRAUD_DISPOSABLE_EMAIL_DOMAINS,
  FRAUD_ENABLED,
  FRAUD_RULE_KEYS,
  FRAUD_SHARED_IDENTITY_WINDOW_DAYS,
  FRAUD_VELOCITY_WINDOW_MINUTES,
  type FraudRuleSetting,
} from './fraud.config';
import { evaluateRules, type RuleSettings } from './internal/rule-engine';

/**
 * Owns `fraud_evaluations` — the scoring engine and its evidence.
 *
 * ## What this module is not allowed to do
 *
 * **It never moves money.** `evaluate()` returns a recommendation; `record()`
 * stores what happened. Neither touches a balance, and neither can: this
 * service does not inject `RewardAccountingService` and `arch.spec.ts` fails
 * the build if it ever does. Points move in the caller's transaction, through
 * the accounting service, exactly as they do for every other source (P2).
 *
 * ## Why it depends on nothing
 *
 * ARCHITECTURE.md §4.2. The obvious design has `fraud` reading clicks and
 * conversions and `conversions` calling `fraud` — a cycle that `forwardRef()`
 * hides and that makes both modules untestable alone. Instead the caller
 * assembles a `FraudEvaluationContext` of primitives and passes it in.
 *
 * The imports of this file are the proof: `core/config`, `core/database`,
 * `core/errors`, and its own internals. No business module appears, and none
 * can be added without failing the architecture test.
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
  ) {}

  /**
   * Score a conversion. Reads configuration, applies the rules, returns.
   *
   * Nothing is written here — an evaluation is only worth storing once the
   * caller knows what it did with it, which is what `record()` takes.
   */
  async evaluate(context: FraudEvaluationContext): Promise<FraudEvaluationResult> {
    const settings = await this.resolveSettings(context.providerId);

    return evaluateRules(context, settings);
  }

  /**
   * The time windows the caller must count over to assemble a context.
   *
   * Exposed as a method rather than by exporting the configuration keys, so
   * that the windows and the rules that use them stay owned by one module.
   * A caller reading `fraud.velocity_window_minutes` itself would be a second
   * place that decides what "recent" means, and the two would drift.
   *
   * Both reads hit the in-process configuration cache (§14.3), so asking for
   * them separately from `evaluate()` costs nothing.
   */
  async windowsFor(providerId: string): Promise<{
    velocityWindowMinutes: number;
    sharedIdentityWindowDays: number;
  }> {
    const [velocityWindowMinutes, sharedIdentityWindowDays] = await Promise.all([
      this.configuration.get<number>(FRAUD_VELOCITY_WINDOW_MINUTES.key, providerId),
      this.configuration.get<number>(FRAUD_SHARED_IDENTITY_WINDOW_DAYS.key, providerId),
    ]);

    return { velocityWindowMinutes, sharedIdentityWindowDays };
  }

  /**
   * Store an evaluation as evidence (DATABASE.md §3.6).
   *
   * Takes the applied action separately from the recommended one. They differ
   * legitimately — a provider-pending conversion credits nothing whatever the
   * score — and recording only the recommendation would leave a held-looking
   * evaluation whose points moved anyway with no explanation.
   *
   * Accepts a transaction client so the evidence and the conversion it
   * explains commit together. An evaluation without its conversion is a
   * dangling record; a conversion without its evaluation is an unexplainable
   * hold.
   */
  async record(
    input: {
      userId: string;
      result: FraudEvaluationResult;
      appliedAction: FraudAction;
    },
    client?: PrismaTransactionClient,
  ): Promise<FraudEvaluation> {
    const db = client ?? this.prisma;

    return db.fraudEvaluation.create({
      data: {
        id: uuidv7(),
        userId: input.userId,
        score: input.result.score,
        action: input.result.action,
        appliedAction: input.appliedAction,
        triggered: input.result.triggered as unknown as Prisma.InputJsonValue,
        ruleSnapshot: input.result.snapshot as unknown as Prisma.InputJsonValue,
        skipped: input.result.skipped as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findById(id: string): Promise<FraudEvaluation | null> {
    return this.prisma.fraudEvaluation.findUnique({ where: { id } });
  }

  async requireById(id: string): Promise<FraudEvaluation> {
    const evaluation = await this.findById(id);

    if (!evaluation) {
      throw new DomainError(
        ERROR_CODES.FRAUD_EVALUATION_NOT_FOUND,
        'This fraud evaluation does not exist',
        404,
        { evaluationId: id },
      );
    }

    return evaluation;
  }

  /**
   * What §11.3 wants on the payout review screen (TODO T32).
   *
   * *"The admin sees the account's fraud score, conversion history, chargeback
   * rate, account age, and any shared-device or shared-IP signals alongside the
   * request."*
   *
   * Peak and latest rather than one number: an account that scored high once
   * and has been clean since is a different account from one scoring high now,
   * and a single figure cannot say which is which.
   */
  async signalsFor(userId: string): Promise<UserFraudSignals> {
    const evaluations = await this.prisma.fraudEvaluation.findMany({
      where: { userId },
      orderBy: { evaluatedAt: 'desc' },
      take: SIGNALS_SCAN_LIMIT,
    });

    const rules = new Set<FraudRuleId>();

    for (const evaluation of evaluations) {
      for (const rule of triggeredOf(evaluation)) rules.add(rule.rule);
    }

    return {
      peakScore: evaluations.reduce((peak, item) => Math.max(peak, item.score), 0),
      latestScore: evaluations[0]?.score ?? null,
      flaggedCount: evaluations.filter((item) => item.action !== FRAUD_ACTIONS.ALLOW).length,
      rulesEverTriggered: [...rules].sort(),
    };
  }

  async findMany(query: {
    userId?: string;
    action?: FraudAction;
    limit?: number;
    offset?: number;
  }): Promise<{ items: FraudEvaluation[]; total: number }> {
    const where: Prisma.FraudEvaluationWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.fraudEvaluation.findMany({
        where,
        orderBy: { evaluatedAt: 'desc' },
        take: clampLimit(query.limit),
        skip: query.offset ?? 0,
      }),
      this.prisma.fraudEvaluation.count({ where }),
    ]);

    return { items, total };
  }

  toSummary(evaluation: FraudEvaluation, conversionId: string | null): AdminFraudEvaluationSummary {
    return {
      id: evaluation.id,
      conversionId,
      userId: evaluation.userId,
      score: evaluation.score,
      recommendedAction: evaluation.action,
      appliedAction: evaluation.appliedAction,
      triggeredRules: triggeredOf(evaluation).map((rule) => rule.rule),
      evaluatedAt: evaluation.evaluatedAt.toISOString(),
    };
  }

  toDetail(evaluation: FraudEvaluation, conversionId: string | null): AdminFraudEvaluationDetail {
    return {
      ...this.toSummary(evaluation, conversionId),
      triggered: triggeredOf(evaluation),
      snapshot: snapshotOf(evaluation),
      skipped: skippedOf(evaluation),
    };
  }

  /**
   * Resolve every rule's configuration for this provider, once.
   *
   * Read before evaluation and never during it — the engine is pure, and a
   * configuration read inside a rule would make a rule's answer depend on when
   * it ran. It is also read before any transaction the caller may open, for
   * the reason §10.2 rule 4 gives: a configuration read must never extend the
   * window a balance row is locked for.
   */
  private async resolveSettings(providerId: string): Promise<RuleSettings> {
    const [enabled, chargebackMinimumConversions, disposableEmailDomains, ...ruleValues] =
      await Promise.all([
        this.configuration.get<boolean>(FRAUD_ENABLED.key),
        this.configuration.get<number>(FRAUD_CHARGEBACK_MINIMUM_CONVERSIONS.key, providerId),
        this.configuration.get<string[]>(FRAUD_DISPOSABLE_EMAIL_DOMAINS.key),
        ...RULE_IDS.map((rule) =>
          this.configuration.get<FraudRuleSetting>(FRAUD_RULE_KEYS[rule].key, providerId),
        ),
      ]);

    const rules = Object.fromEntries(
      RULE_IDS.map((rule, index) => [rule, ruleValues[index]]),
    ) as Record<FraudRuleId, FraudRuleSetting>;

    if (!enabled) {
      this.logger.warn(
        { providerId },
        'Fraud scoring is disabled; every rule will be recorded as skipped',
      );
    }

    return {
      enabled,
      rules,
      chargebackMinimumConversions,
      /*
       * Lowercased here rather than trusted from configuration. An admin
       * typing `Mailinator.com` into the blocklist should not produce a rule
       * that silently never matches.
       */
      disposableEmailDomains: disposableEmailDomains.map((domain) => domain.trim().toLowerCase()),
    };
  }
}

const RULE_IDS = Object.values(FRAUD_RULES);

/**
 * How many of a user's evaluations the signals summary reads.
 *
 * Bounded because an account under investigation is exactly the account with
 * the most evaluations, and an unbounded read would be slowest on the row the
 * admin is waiting for. `peakScore` is therefore the peak within this window,
 * which is what the review screen needs — a spike two thousand conversions ago
 * is history, not a signal.
 */
const SIGNALS_SCAN_LIMIT = 200;

/*
 * The three JSON columns, read back with their shapes restored.
 *
 * Prisma types a `Json` column as `JsonValue`, which is honest — the database
 * cannot promise what is in there. These functions are the one place that
 * honesty is converted into the shape the rest of the code uses, so a schema
 * change breaks in one place rather than everywhere the column is read.
 */
function triggeredOf(evaluation: FraudEvaluation): TriggeredRule[] {
  return (evaluation.triggered ?? []) as unknown as TriggeredRule[];
}

function snapshotOf(evaluation: FraudEvaluation): FraudRuleSnapshot[] {
  return (evaluation.ruleSnapshot ?? []) as unknown as FraudRuleSnapshot[];
}

function skippedOf(evaluation: FraudEvaluation): { rule: FraudRuleId; reason: string }[] {
  return (evaluation.skipped ?? []) as unknown as { rule: FraudRuleId; reason: string }[];
}

function clampLimit(requested: number | undefined): number {
  if (!requested || requested < 1) return 25;

  return Math.min(requested, 100);
}
