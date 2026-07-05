import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantAccessGuard } from './common/guards/tenant-access.guard';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 10,
      },
      {
        name: 'medium',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'long',
        ttl: 3600000,
        limit: 1000,
      },
    ]),
    PrismaModule,
    AuthModule,
    HealthModule,
    MailModule,
    TeamsModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RolesGuard,
    TenantAccessGuard,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware, TenantContextMiddleware).forRoutes('*');
  }
}
