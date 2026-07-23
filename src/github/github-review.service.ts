import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Role } from '@prisma/client';
import { z } from 'zod';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { EncryptionService } from '../common/services/encryption.service';
import { serializeResponse } from '../common/utils/response';
import type { AppEnv } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { GitHubReviewJob } from '../queue/queue.types';
import { RAGService } from '../rag/rag.service';
import { GitHubApiClient } from './github-api.client';
import {
  planGitHubReviewContext,
  type PlannedGitHubFile,
} from './github-context-planner';
import { GitHubDecisionService } from './github-decision.service';
import { GitHubReportService } from './github-report.service';
import type {
  GitHubFileReview,
  GitHubReviewIssue,
  GitHubReviewSummary,
} from './github-review.types';

const issueSchema = z.object({
  severity: z
    .enum(['critical', 'high', 'medium', 'low', 'info'])
    .default('medium'),
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(4000),
  line: z.coerce.number().int().positive().optional(),
  suggestion: z.string().max(4000).optional(),
});

const fileReviewSchema = z.object({
  fileScore: z.coerce.number().min(0).max(100),
  summary: z.string().min(1).max(4000),
  issues: z.array(issueSchema).max(30).default([]),
  strengths: z.array(z.string().max(1000)).max(20).default([]),
  suggestions: z.array(z.string().max(2000)).max(20).default([]),
});

type FileSnapshot = PlannedGitHubFile & {
  previousContent: string | null;
  proposedContent: string | null;
  review?: GitHubFileReview;
};

@Injectable()
export class GitHubReviewService {
  private readonly logger = new Logger(GitHubReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: GitHubApiClient,
    private readonly encryption: EncryptionService,
    private readonly rag: RAGService,
    private readonly reportService: GitHubReportService,
    private readonly decisionService: GitHubDecisionService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  async requestReview(user: JwtUser, pullRequestId: string) {
    const { organizationId, role } = this.getOrganizationContext(user);
    this.assertReviewer(role);
    const pullRequest = await this.prisma.gitHubPullRequest.findFirst({
      where: {
        id: pullRequestId,
        organizationId,
        repository: { isActive: true },
      },
      select: {
        id: true,
        headSha: true,
        state: true,
      },
    });
    if (!pullRequest) {
      throw new NotFoundException('Pull request was not found.');
    }
    if (pullRequest.state !== 'OPEN') {
      throw new ForbiddenException('Only open pull requests can be reviewed.');
    }
    await this.prisma.gitHubPullRequest.update({
      where: { id: pullRequest.id },
      data: {
        aiReviewStatus: 'PENDING',
        lastReviewError: null,
      },
    });
    const job = await this.queue.enqueueGitHubReview(
      {
        pullRequestId: pullRequest.id,
        organizationId,
        headSha: pullRequest.headSha,
        trigger: 'MANUAL',
        triggeredById: user.sub,
      },
      false,
    );
    return serializeResponse({
      message: 'AI review queued.',
      ...job,
    });
  }

  async startReviewPipeline(job: GitHubReviewJob) {
    const pullRequest = await this.prisma.gitHubPullRequest.findFirst({
      where: {
        id: job.pullRequestId,
        organizationId: job.organizationId,
      },
      include: {
        repository: {
          include: {
            connection: { select: { accessToken: true } },
          },
        },
      },
    });
    if (
      !pullRequest ||
      !pullRequest.repository.isActive ||
      pullRequest.state !== 'OPEN'
    ) {
      return { skipped: true, reason: 'Pull request is no longer active.' };
    }
    if (pullRequest.headSha !== job.headSha) {
      return { skipped: true, reason: 'A newer pull request head exists.' };
    }
    if (
      pullRequest.lastReviewHeadSha === job.headSha &&
      pullRequest.aiReviewStatus === 'COMPLETED' &&
      job.trigger === 'WEBHOOK'
    ) {
      return { skipped: true, reason: 'Head SHA was already reviewed.' };
    }

    const dailyLimit = this.config.getOrThrow('GITHUB_REVIEW_DAILY_LIMIT', {
      infer: true,
    });
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const reviewsToday = await this.prisma.gitHubPRReviewReport.count({
      where: {
        pullRequest: { organizationId: job.organizationId },
        createdAt: { gte: startOfDay },
      },
    });
    if (reviewsToday >= dailyLimit) {
      await this.prisma.gitHubPullRequest.update({
        where: { id: pullRequest.id },
        data: {
          aiReviewStatus: 'NEEDS_ATTENTION',
          lastReviewError:
            'The organization daily AI review limit has been reached.',
        },
      });
      return { skipped: true, reason: 'Daily review limit reached.' };
    }

    await this.prisma.gitHubPullRequest.update({
      where: { id: pullRequest.id },
      data: {
        aiReviewStatus: 'RUNNING',
        lastReviewError: null,
      },
    });

    const token = this.encryption.decrypt(
      pullRequest.repository.connection.accessToken,
    );
    await this.api
      .createCommitStatus(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.headSha,
        'pending',
        'TaskFlow AI review is running',
      )
      .catch(() => undefined);

    try {
      const latest = await this.api.getPullRequest(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.number,
      );
      if (latest.headSha !== job.headSha) {
        await this.prisma.gitHubPullRequest.update({
          where: { id: pullRequest.id },
          data: {
            headSha: latest.headSha,
            aiReviewStatus: 'PENDING',
          },
        });
        return { skipped: true, reason: 'A newer head was found on GitHub.' };
      }

      const changedFiles = await this.api.listPullRequestFiles(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.number,
      );
      const planned = planGitHubReviewContext(
        changedFiles,
        pullRequest.repository.maxContextCharacters,
      );
      const snapshots = await mapWithConcurrency(planned, 3, async (file) =>
        this.loadFileSnapshot(token, pullRequest.repository, pullRequest, file),
      );
      const reviewedSnapshots = await mapWithConcurrency(
        snapshots,
        3,
        async (snapshot) => {
          if (!snapshot.isReviewable) return snapshot;
          return {
            ...snapshot,
            review: await this.reviewFileDiff(snapshot),
          };
        },
      );
      const review = this.aggregateReview(reviewedSnapshots);
      const testRunStatus = pullRequest.repository.testEnabled
        ? ('SKIPPED' as const)
        : ('DISABLED' as const);
      const testOutput = pullRequest.repository.testEnabled
        ? 'Test execution was skipped because no isolated runner is configured. TaskFlow never executes pull request code on the API server.'
        : null;
      const decision = this.decisionService.getAutomatedDecision(
        review.score,
        pullRequest.repository.aiScoreThreshold,
      );
      const reportMarkdown = this.reportService.generate({
        repository: pullRequest.repository.fullName,
        pullRequestNumber: pullRequest.number,
        headSha: pullRequest.headSha,
        threshold: pullRequest.repository.aiScoreThreshold,
        decision,
        testStatus: testRunStatus,
        review,
      });

      await this.persistFileSnapshots(pullRequest.id, reviewedSnapshots);
      const aggregate = await this.prisma.gitHubPRReviewReport.aggregate({
        where: { pullRequestId: pullRequest.id },
        _max: { version: true },
      });
      const version = (aggregate._max.version || 0) + 1;
      const contextStats = {
        configuredBudget: pullRequest.repository.maxContextCharacters,
        usedCharacters: reviewedSnapshots.reduce(
          (sum, file) => sum + file.contextBudget,
          0,
        ),
        filesReceived: changedFiles.length,
        filesReviewed: review.filesReviewed,
        filesSkipped: review.filesSkipped,
      };
      await this.prisma.$transaction([
        this.prisma.gitHubPullRequest.update({
          where: { id: pullRequest.id },
          data: {
            aiReviewStatus: 'COMPLETED',
            aiScore: review.score,
            aiReviewSummary: review.summary,
            finalDecision: decision,
            finalDecidedById: null,
            finalDecisionNote: null,
            testRunStatus,
            testOutput,
            lastReviewHeadSha: pullRequest.headSha,
            lastReviewError: null,
          },
        }),
        this.prisma.gitHubPRReviewReport.create({
          data: {
            pullRequestId: pullRequest.id,
            version,
            headSha: pullRequest.headSha,
            trigger: job.trigger,
            triggeredById: job.triggeredById,
            aiScore: review.score,
            aiReviewJson: review,
            reportMarkdown,
            testSummaryJson: {
              status: testRunStatus,
              output: testOutput,
            },
            contextStats,
            decision,
          },
        }),
      ]);

      try {
        await this.decisionService.publishAutomatedDecision(
          pullRequest.id,
          reportMarkdown,
        );
      } catch (error) {
        this.logger.warn(
          `Review completed but GitHub publishing failed for PR ${pullRequest.id}: ${this.formatError(
            error,
          )}`,
        );
        await this.prisma.gitHubPullRequest.update({
          where: { id: pullRequest.id },
          data: {
            aiReviewStatus: 'NEEDS_ATTENTION',
            lastReviewError:
              'The review completed, but the GitHub status or comment could not be published.',
          },
        });
      }

      if (pullRequest.authorId) {
        await this.notifications.createNotification({
          userId: pullRequest.authorId,
          organizationId: pullRequest.organizationId,
          type: 'GITHUB_PR_REVIEW_COMPLETED',
          title: `AI review completed for PR #${pullRequest.number}`,
          body: `TaskFlow scored ${pullRequest.title} at ${review.score}/100.`,
          metadata: {
            pullRequestId: pullRequest.id,
            repositoryId: pullRequest.repositoryId,
            score: review.score,
            decision,
          },
        });
      }
      return {
        skipped: false,
        score: review.score,
        decision,
        version,
      };
    } catch (error) {
      await this.prisma.gitHubPullRequest.update({
        where: { id: pullRequest.id },
        data: {
          aiReviewStatus: 'FAILED',
          lastReviewError: this.formatError(error).slice(0, 1000),
        },
      });
      throw error;
    }
  }

  async handleExhausted(job: GitHubReviewJob, error: Error) {
    const pullRequest = await this.prisma.gitHubPullRequest.findFirst({
      where: {
        id: job.pullRequestId,
        organizationId: job.organizationId,
      },
      select: {
        id: true,
        number: true,
        title: true,
        repositoryId: true,
      },
    });
    if (!pullRequest) return;
    await this.prisma.gitHubPullRequest.update({
      where: { id: pullRequest.id },
      data: {
        aiReviewStatus: 'NEEDS_ATTENTION',
        lastReviewError: error.message.slice(0, 1000),
      },
    });
    const reviewers = await this.prisma.organizationMembership.findMany({
      where: {
        organizationId: job.organizationId,
        status: 'ACTIVE',
        role: { in: ['MANAGER', 'TEAM_LEADER'] },
      },
      select: { userId: true },
    });
    await this.notifications.createBulkNotifications(
      reviewers.map((reviewer) => reviewer.userId),
      {
        organizationId: job.organizationId,
        type: 'GITHUB_PR_REVIEW_FAILED',
        title: `PR #${pullRequest.number} needs review attention`,
        body: `AI review could not finish after retrying. Open ${pullRequest.title} to inspect the failure.`,
        metadata: {
          pullRequestId: pullRequest.id,
          repositoryId: pullRequest.repositoryId,
        },
      },
    );
  }

  private async loadFileSnapshot(
    token: string,
    repository: {
      owner: string;
      name: string;
    },
    pullRequest: {
      baseSha: string;
      headSha: string;
    },
    file: PlannedGitHubFile,
  ): Promise<FileSnapshot> {
    if (!file.isReviewable) {
      return { ...file, previousContent: null, proposedContent: null };
    }
    const previousPath = file.previous_filename || file.filename;
    const [previousContent, proposedContent] = await Promise.all([
      file.status === 'added'
        ? Promise.resolve(null)
        : this.api.getFileContent(
            token,
            repository.owner,
            repository.name,
            previousPath,
            pullRequest.baseSha,
          ),
      file.status === 'removed'
        ? Promise.resolve(null)
        : this.api.getFileContent(
            token,
            repository.owner,
            repository.name,
            file.filename,
            pullRequest.headSha,
          ),
    ]);
    return {
      ...file,
      previousContent: capSource(previousContent),
      proposedContent: capSource(proposedContent),
    };
  }

  private async reviewFileDiff(
    snapshot: FileSnapshot,
  ): Promise<GitHubFileReview> {
    const context = buildOptimizedContext(snapshot);
    const prompt = [
      'Review this pull request file change as a senior software engineer.',
      'Focus in this order: exploitable security problems, correctness bugs, authorization/data isolation, performance regressions, maintainability, then style.',
      'Do not invent code outside the supplied base/proposed/diff context.',
      'Score 100 for safe, correct, production-ready code and lower the score according to concrete risk.',
      'Return JSON with: fileScore (0-100), summary, issues[{severity,title,description,line?,suggestion?}], strengths[], suggestions[].',
    ].join('\n');
    try {
      const response = await withTimeout(
        this.rag.generateStructuredResponse(prompt, [context]),
        45000,
      );
      const parsed = fileReviewSchema.parse(response);
      return {
        ...parsed,
        fileScore: Math.round(parsed.fileScore),
      };
    } catch {
      return {
        fileScore: 50,
        summary:
          'The AI provider did not return a valid file review. Human review is required.',
        issues: [
          {
            severity: 'info',
            title: 'AI file review unavailable',
            description:
              'TaskFlow preserved the code comparison, but could not produce a reliable structured AI response for this file.',
            suggestion:
              'Review this file manually or re-run the AI review when the provider is available.',
          },
        ],
        strengths: [],
        suggestions: [],
        fallback: true,
      };
    }
  }

  private aggregateReview(files: FileSnapshot[]): GitHubReviewSummary {
    const reviewed = files.filter(
      (file): file is FileSnapshot & { review: GitHubFileReview } =>
        Boolean(file.review),
    );
    const score = reviewed.length
      ? Math.round(
          reviewed.reduce((sum, file) => sum + file.review.fileScore, 0) /
            reviewed.length,
        )
      : 100;
    const severityRank: Record<GitHubReviewIssue['severity'], number> = {
      critical: 5,
      high: 4,
      medium: 3,
      low: 2,
      info: 1,
    };
    const issues = reviewed
      .flatMap((file) =>
        file.review.issues.map((issue) => ({
          ...issue,
          path: file.filename,
        })),
      )
      .sort(
        (left, right) =>
          severityRank[right.severity] - severityRank[left.severity],
      );
    const critical = issues.filter(
      (issue) => issue.severity === 'critical',
    ).length;
    const high = issues.filter((issue) => issue.severity === 'high').length;
    const summary = issues.length
      ? `Reviewed ${reviewed.length} file(s) and found ${issues.length} actionable item(s), including ${critical} critical and ${high} high-severity finding(s).`
      : `Reviewed ${reviewed.length} file(s) with no actionable issues in the supplied change context.`;
    return {
      score,
      summary,
      filesReviewed: reviewed.length,
      filesSkipped: files.length - reviewed.length,
      issues,
      strengths: reviewed.flatMap((file) =>
        file.review.strengths.map((text) => ({
          path: file.filename,
          text,
        })),
      ),
    };
  }

  private async persistFileSnapshots(
    pullRequestId: string,
    snapshots: FileSnapshot[],
  ) {
    await this.prisma.$transaction([
      this.prisma.gitHubPullRequestFile.deleteMany({
        where: {
          pullRequestId,
          ...(snapshots.length
            ? {
                path: { notIn: snapshots.map((snapshot) => snapshot.filename) },
              }
            : {}),
        },
      }),
      ...snapshots.map((snapshot) =>
        this.prisma.gitHubPullRequestFile.upsert({
          where: {
            pullRequestId_path: {
              pullRequestId,
              path: snapshot.filename,
            },
          },
          create: {
            pullRequestId,
            path: snapshot.filename,
            previousPath: snapshot.previous_filename,
            status: snapshot.status,
            additions: snapshot.additions,
            deletions: snapshot.deletions,
            changes: snapshot.changes,
            patch: snapshot.patch,
            previousContent: snapshot.previousContent,
            proposedContent: snapshot.proposedContent,
            language: snapshot.language,
            isBinary: snapshot.isBinary,
            isReviewable: snapshot.isReviewable,
            contextCharacters: snapshot.contextBudget,
            aiScore: snapshot.review?.fileScore,
            aiReviewJson: snapshot.review
              ? (snapshot.review as unknown as Prisma.InputJsonValue)
              : undefined,
            aiSummary: snapshot.review?.summary,
            reviewedAt: snapshot.review ? new Date() : undefined,
          },
          update: {
            previousPath: snapshot.previous_filename || null,
            status: snapshot.status,
            additions: snapshot.additions,
            deletions: snapshot.deletions,
            changes: snapshot.changes,
            patch: snapshot.patch || null,
            previousContent: snapshot.previousContent,
            proposedContent: snapshot.proposedContent,
            language: snapshot.language,
            isBinary: snapshot.isBinary,
            isReviewable: snapshot.isReviewable,
            contextCharacters: snapshot.contextBudget,
            aiScore: snapshot.review?.fileScore || null,
            aiReviewJson: snapshot.review
              ? (snapshot.review as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            aiSummary: snapshot.review?.summary || null,
            reviewedAt: snapshot.review ? new Date() : null,
          },
        }),
      ),
    ]);
  }

  private getOrganizationContext(user: JwtUser) {
    const organizationId = user.currentOrganizationId || undefined;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required.');
    }
    const role =
      user.role === 'SUPER_ADMIN'
        ? ('SUPER_ADMIN' as Role)
        : user.memberships.find(
            (membership) =>
              membership.organizationId === organizationId &&
              membership.status === 'ACTIVE',
          )?.role;
    if (!role) {
      throw new ForbiddenException(
        'An active organization membership is required.',
      );
    }
    return { organizationId, role };
  }

  private assertReviewer(role: Role) {
    if (!['SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER'].includes(role)) {
      throw new ForbiddenException(
        'AI review controls are restricted to reviewers.',
      );
    }
  }

  private formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

function buildOptimizedContext(snapshot: FileSnapshot) {
  const budget = snapshot.contextBudget;
  const patchBudget = Math.floor(budget * 0.5);
  const sourceBudget = Math.floor((budget - patchBudget) / 2);
  return [
    `File: ${snapshot.filename}`,
    `Language: ${snapshot.language || 'Unknown'}`,
    `Status: ${snapshot.status}`,
    `Base code:\n${sliceContext(snapshot.previousContent, sourceBudget)}`,
    `Proposed code:\n${sliceContext(snapshot.proposedContent, sourceBudget)}`,
    `Unified diff:\n${sliceContext(snapshot.patch || '', patchBudget)}`,
  ].join('\n\n');
}

function sliceContext(value: string | null, limit: number) {
  if (!value) return '[not available]';
  if (value.length <= limit) return value;
  const half = Math.floor((limit - 80) / 2);
  return `${value.slice(0, half)}\n\n[context truncated]\n\n${value.slice(-half)}`;
}

function capSource(value: string | null) {
  if (!value) return null;
  return value.length <= 100000
    ? value
    : `${value.slice(0, 50000)}\n\n[stored source truncated]\n\n${value.slice(
        -50000,
      )}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('AI file review timed out.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
