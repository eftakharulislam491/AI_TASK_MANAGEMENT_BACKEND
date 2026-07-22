import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from './activity/activity.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantAccessGuard } from './common/guards/tenant-access.guard';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { CommentsModule } from './comments/comments.module';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RAGModule } from './rag/rag.module';
import { RequirementsModule } from './requirements/requirements.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TasksModule } from './tasks/tasks.module';
import { TeamsModule } from './teams/teams.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([
      { ttl: 1000, limit: 10 },
      { ttl: 60000, limit: 100 },
      { ttl: 3600000, limit: 1000 },
    ]),
    ActivityModule,
    AttachmentsModule,
    AuthModule,
    CommentsModule,
    HealthModule,
    InvitationsModule,
    MailModule,
    NotificationsModule,
    PrismaModule,
    ProjectsModule,
    RAGModule,
    RequirementsModule,
    SchedulerModule,
    TasksModule,
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
    consumer
      .apply(LoggerMiddleware, TenantContextMiddleware)
      .forRoutes('{*path}');
  }
}
