import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RAGModule } from '../rag/rag.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    ActivityModule,
    MailModule,
    NotificationsModule,
    PrismaModule,
    RAGModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
