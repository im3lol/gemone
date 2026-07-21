import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';

async function bootstrap() {
  // Errors during boot are buffered until the pino logger takes over.
  // rawBody: keep the exact request bytes so AdGem v3 postback signatures
  // (HMAC of the raw JSON body) can be verified without re-serialization drift.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);

  // Structured JSON logging with request correlation ids.
  app.useLogger(app.get(Logger));

  const sentryOn = initSentry(config.get('SENTRY_DSN'), config.get('NODE_ENV', 'development'));

  // Behind a proxy in prod — needed for correct client IP capture (fraud).
  app.set('trust proxy', 1);

  // Security headers.
  app.use(helmet());

  app.enableCors({
    origin: config.get('WEB_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const port = Number(config.get('PORT', 4000));
  await app.listen(port);
  app.get(Logger).log(`API listening on http://localhost:${port} (sentry: ${sentryOn ? 'on' : 'off'})`);
}
void bootstrap();
