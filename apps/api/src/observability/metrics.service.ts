import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// Central Prometheus registry + the business metrics the plan wants to alert on
// (payout failures, reversals, queue backlog) plus HTTP latency.
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  readonly payoutFailures = new Counter({
    name: 'gemone_payout_failures_total',
    help: 'Payouts that failed permanently and were refunded',
    registers: [this.registry],
  });

  readonly reversals = new Counter({
    name: 'gemone_reversals_total',
    help: 'Postback reversals (chargebacks) processed',
    registers: [this.registry],
  });

  readonly creditsGranted = new Counter({
    name: 'gemone_credits_total',
    help: 'Postback credits granted',
    registers: [this.registry],
  });

  readonly queueDepth = new Gauge({
    name: 'gemone_payout_queue_depth',
    help: 'Jobs waiting/active in the payout queue',
    labelNames: ['state'],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ app: 'gemone-api' });
    collectDefaultMetrics({ register: this.registry });
  }

  metrics() {
    return this.registry.metrics();
  }
}
