import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import type { AppEnv } from './config/env';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const port = configService.getOrThrow('PORT', { infer: true });
  const nodeEnv = configService.getOrThrow('NODE_ENV', { infer: true });
  const allowedOrigins = configService
    .getOrThrow('ALLOWED_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  app.enableCors({
    origin: nodeEnv === 'production' ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-organization-id',
      'x-refresh-token',
    ],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter(), new ZodExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const server = await app.listen(port);

  process.on('SIGTERM', async () => {
    console.log('[TaskFlow] SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('[TaskFlow] HTTP server closed.');
    });
    await app.close();
    process.exit(0);
  });

  const appUrl = await app.getUrl();

  console.log(`[TaskFlow] Running on: ${appUrl}/api/v1`);
  console.log(`[TaskFlow] Environment: ${nodeEnv}`);
}
bootstrap();
