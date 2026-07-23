import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EncryptionService } from '../common/services/encryption.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { GitHubReviewProcessor } from '../queue/processors/github-review.processor';
import { RAGModule } from '../rag/rag.module';
import { GitHubApiClient } from './github-api.client';
import { GitHubDecisionService } from './github-decision.service';
import { GitHubOAuthController } from './github-oauth.controller';
import { GitHubReportService } from './github-report.service';
import { GitHubReviewService } from './github-review.service';
import { GitHubWebhookController } from './github-webhook.controller';
import { GitHubController } from './github.controller';
import { GitHubService } from './github.service';

@Module({
  imports: [AuthModule, NotificationsModule, QueueModule, RAGModule],
  controllers: [
    GitHubController,
    GitHubOAuthController,
    GitHubWebhookController,
  ],
  providers: [
    EncryptionService,
    GitHubApiClient,
    GitHubDecisionService,
    GitHubReportService,
    GitHubReviewService,
    GitHubService,
    GitHubReviewProcessor,
  ],
  exports: [GitHubService],
})
export class GitHubModule {}
