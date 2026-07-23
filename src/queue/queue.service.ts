import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker, type Processor } from 'bullmq';
import IORedis from 'ioredis';
import type { AppEnv } from '../config/env';
import { GITHUB_REVIEW_QUEUE, type GitHubReviewJob } from './queue.types';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly connection: IORedis;
  private readonly reviewQueue: Queue<GitHubReviewJob>;
  private reviewWorker?: Worker<GitHubReviewJob>;

  constructor(config: ConfigService<AppEnv, true>) {
    const redisUrl = config.get('REDIS_URL', { infer: true });
    this.connection = redisUrl
      ? new IORedis(redisUrl, {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        })
      : new IORedis({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
    this.connection.on('error', (error) => {
      this.logger.warn(`Queue Redis error: ${this.formatError(error)}`);
    });
    this.reviewQueue = new Queue<GitHubReviewJob>(GITHUB_REVIEW_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400, count: 5000 },
        removeOnFail: { age: 604800, count: 5000 },
      },
    });
  }

  async enqueueGitHubReview(
    data: GitHubReviewJob,
    deduplicate = true,
  ): Promise<{ jobId: string }> {
    const jobId = deduplicate
      ? `${data.pullRequestId}-${data.headSha}`
      : `${data.pullRequestId}-${data.headSha}-${Date.now()}`;
    const job = await this.reviewQueue.add('review-pull-request', data, {
      jobId,
    });
    this.logger.log(
      `Queued GitHub review job ${job.id || jobId} for PR ${data.pullRequestId}.`,
    );
    return { jobId: String(job.id || jobId) };
  }

  registerGitHubReviewWorker(
    processor: Processor<GitHubReviewJob>,
    onExhausted?: (job: Job<GitHubReviewJob>, error: Error) => Promise<void>,
  ) {
    if (this.reviewWorker) return;

    this.reviewWorker = new Worker<GitHubReviewJob>(
      GITHUB_REVIEW_QUEUE,
      processor,
      {
        connection: this.connection.duplicate(),
        concurrency: 2,
      },
    );
    this.reviewWorker.on('completed', (job) => {
      this.logger.log(`GitHub review job ${job.id} completed.`);
    });
    this.reviewWorker.on('failed', (job, error) => {
      this.logger.error(
        `GitHub review job ${job?.id || 'unknown'} failed: ${this.formatError(
          error,
        )}`,
      );
      if (job && job.attemptsMade >= (job.opts.attempts || 1) && onExhausted) {
        void onExhausted(job, error);
      }
    });
  }

  async onModuleDestroy() {
    await this.reviewWorker?.close();
    await this.reviewQueue.close();
    await this.connection.quit();
  }

  private formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
