import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RAGModule } from '../rag/rag.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MailModule,
    NotificationsModule,
    PrismaModule,
    RAGModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
