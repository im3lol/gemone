import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { loadEnv } from './core/config/env.schema';
import { loadDotenvForDevelopment } from './core/config/load-dotenv';
import { createValidationPipe } from './core/errors/validation-pipe';
import { CORRELATION_ID_HEADER } from './core/logging/correlation';

/**
 * The `api` entrypoint — HTTP surface (§1.2).
 *
 * Environment is validated before the application is created, so a
 * misconfigured process dies immediately with a readable message rather than
 * failing later on whichever request first needs the missing value.
 */
async function bootstrap(): Promise<void> {
  loadDotenvForDevelopment();
  const env = loadEnv();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,

    /*
     * Keeps the undecoded request body available as `request.rawBody`.
     *
     * Needed by the postback surface (§10.1): a provider that signs its body
     * signs the *bytes*, and re-serialising the parsed object changes key
     * order, whitespace and number formatting — which turns every postback
     * from such a provider into a signature rejection. No adapter needs it
     * today; the contract promises it, and the flag is the only way to keep
     * that promise once one does.
     */
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  // Parses the refresh cookie. Unsigned: the token is 256 bits of entropy and
  // its validity is established by a database lookup, so a cookie signature
  // would add a second secret to manage and prove nothing extra.
  app.use(cookieParser());

  app.useGlobalPipes(createValidationPipe());

  // Do not advertise the framework.
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  /*
   * Client IP resolution — ARCHITECTURE.md §19.1, §19.5.
   *
   * Behind Caddy, `request.ip` is Caddy's address unless Express is told how
   * many proxies to trust. Without this the click record captures the proxy
   * rather than the user, and the per-IP click limit counts every user on the
   * platform into one bucket.
   *
   * Configured as a hop count and defaulting to zero, because the failure in
   * the other direction is worse: trusting `X-Forwarded-For` when nothing is
   * in front lets a caller state their own IP, and a limit an attacker
   * chooses the key for is not a limit.
   */
  app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY_HOPS);

  app.enableShutdownHooks();

  await app.listen(env.PORT);

  // `msg` is set explicitly: nestjs-pino reads a trailing string argument as
  // the logging *context*, not the message, so the conventional
  // `log(obj, 'text')` form would file this line under a context named
  // "api listening" with an empty message.
  const logger = app.get(Logger);
  logger.log({
    msg: 'api listening',
    port: env.PORT,
    role: env.APP_ROLE,
    env: env.NODE_ENV,
  });
}

void bootstrap();

export { CORRELATION_ID_HEADER };
