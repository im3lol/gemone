import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Worker entrypoint: same image as the API, but no HTTP server. Boots the Nest
// application context so the BullMQ payout processor (+ schedulers) run here,
// letting workers scale independently of the API. Enable with RUN_WORKERS=true;
// the API runs with RUN_WORKERS=false so it only enqueues.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('GemOne worker started — processing payout queue');
}
void bootstrap();
