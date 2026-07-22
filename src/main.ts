import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Express, Request, Response } from 'express';
import helmet from 'helmet';
import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ZodExceptionFilter } from './common/filters/zod-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import type { AppEnv } from './config/env';
import { createCorsOptionsDelegate } from './config/cors';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const port = configService.getOrThrow('PORT', { infer: true });
  const nodeEnv = configService.getOrThrow('NODE_ENV', { infer: true });
  const allowedOrigins = configService.getOrThrow('ALLOWED_ORIGINS', {
    infer: true,
  });

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  const appUrl = configService.getOrThrow('APP_URL', { infer: true });

  const httpServer = app.getHttpAdapter().getInstance() as Express;
  const uploadsDirectory = join(process.cwd(), 'uploads');
  mkdirSync(uploadsDirectory, { recursive: true });
  httpServer.use('/uploads', express.static(uploadsDirectory));

  httpServer.get('/invitations/accept', (req: Request, res: Response) => {
    const token =
      typeof req.query.token === 'string' ? req.query.token : undefined;
    const redirectUrl = token
      ? `${appUrl}/invite/accept?token=${encodeURIComponent(token)}`
      : `${appUrl}/invite/accept`;

    return res.redirect(302, redirectUrl);
  });

  app.enableCors(
    nodeEnv === 'production'
      ? createCorsOptionsDelegate(allowedOrigins, appUrl)
      : {
          origin: true,
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-organization-id',
            'x-refresh-token',
          ],
        },
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter(), new ZodExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const prismaService = app.get(PrismaService);
  prismaService.enableShutdownHooks(app);

  const server = (await app.listen(port)) as Server;

  process.on('SIGTERM', () => {
    void shutdown(server, async () => app.close());
  });

  const serverUrl = await app.getUrl();

  console.log(`[TaskFlow] Running on: ${serverUrl}/api/v1`);
  console.log(`[TaskFlow] Environment: ${nodeEnv}`);
}

async function shutdown(server: Server, closeApp: () => Promise<void>) {
  console.log('[TaskFlow] SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('[TaskFlow] HTTP server closed.');
  });
  await closeApp();
  process.exit(0);
}

void bootstrap();
