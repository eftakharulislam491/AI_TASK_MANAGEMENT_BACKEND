import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import type { EncryptionService } from '../common/services/encryption.service';
import type { AppEnv } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import type { QueueService } from '../queue/queue.service';
import type { GitHubApiClient } from './github-api.client';
import { GitHubService } from './github.service';

describe('GitHubService webhook idempotency', () => {
  it('accepts a redelivered delivery without enqueueing another review', async () => {
    const secret = 'repository-webhook-secret';
    const rawBody = Buffer.from('{"action":"opened"}');
    const signature = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    const prisma = {
      gitHubRepository: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'repo-1',
            organizationId: 'org-1',
            webhookSecret: 'encrypted',
            autoReviewEnabled: true,
            connection: { githubLogin: 'reviewer' },
            organization: { settings: { githubAutoReviewEnabled: true } },
          },
        ]),
      },
      gitHubWebhookDelivery: {
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('duplicate delivery', {
            code: 'P2002',
            clientVersion: '7.8.0',
          }),
        ),
      },
    } as unknown as PrismaService;
    const enqueueGitHubReview = jest.fn();
    const queue = {
      enqueueGitHubReview,
    } as unknown as QueueService;
    const service = new GitHubService(
      prisma,
      {} as GitHubApiClient,
      {
        decrypt: jest.fn().mockReturnValue(secret),
      } as unknown as EncryptionService,
      {} as JwtService,
      {} as ConfigService<AppEnv, true>,
      queue,
    );

    const result = await service.receiveWebhook({
      rawBody,
      signature,
      deliveryId: 'delivery-1',
      event: 'pull_request',
      payload: {
        action: 'opened',
        repository: { id: '123' },
      },
    });

    expect(result).toEqual({ accepted: true, duplicate: true });
    expect(enqueueGitHubReview).not.toHaveBeenCalled();
  });
});
