import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  imports: [ActivityModule, AuthModule, NotificationsModule, PrismaModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
