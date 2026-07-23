import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { GitHubReviewService } from '../../github/github-review.service';
import { QueueService } from '../queue.service';
import type { GitHubReviewJob } from '../queue.types';

@Injectable()
export class GitHubReviewProcessor implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly reviews: GitHubReviewService,
  ) {}

  onModuleInit() {
    this.queue.registerGitHubReviewWorker(
      async (job: Job<GitHubReviewJob>) =>
        this.reviews.startReviewPipeline(job.data),
      async (job, error) => this.reviews.handleExhausted(job.data, error),
    );
  }
}
