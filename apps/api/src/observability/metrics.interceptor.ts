import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

// Records duration + status for every HTTP request into the Prometheus histogram.
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const end = this.metrics.httpDuration.startTimer();
    // Prefer the matched route pattern (/users/:id) over the raw URL to keep cardinality low.
    const route = () => req.route?.path ?? req.originalUrl?.split('?')[0] ?? 'unknown';

    return next.handle().pipe(
      tap({
        next: () => end({ method: req.method, route: route(), status: res.statusCode }),
        error: () => end({ method: req.method, route: route(), status: res.statusCode || 500 }),
      }),
    );
  }
}
