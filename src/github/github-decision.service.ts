import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { GitHubPRDecision, Role } from '@prisma/client';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { EncryptionService } from '../common/services/encryption.service';
import { serializeResponse } from '../common/utils/response';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { GitHubApiClient } from './github-api.client';
import type { ReviewDecisionInput } from './github.schemas';

@Injectable()
export class GitHubDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: GitHubApiClient,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
  ) {}

  getAutomatedDecision(score: number, threshold: number) {
    return score >= threshold
      ? ('APPROVED' as const)
      : ('CHANGES_REQUESTED' as const);
  }

  async publishAutomatedDecision(
    pullRequestId: string,
    reportMarkdown: string,
  ) {
    const pullRequest = await this.getPullRequestWithCredentials(pullRequestId);
    const token = this.encryption.decrypt(
      pullRequest.repository.connection.accessToken,
    );
    const approved = pullRequest.finalDecision === 'APPROVED';
    await Promise.all([
      this.api.createPullRequestComment(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.number,
        reportMarkdown,
      ),
      this.api.createCommitStatus(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.headSha,
        approved ? 'success' : 'failure',
        approved
          ? `AI review passed with ${pullRequest.aiScore || 0}/100`
          : `AI review needs changes (${pullRequest.aiScore || 0}/100)`,
      ),
    ]);

    if (approved && pullRequest.repository.autoMergeOnPass) {
      const result = await this.api.mergePullRequest(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.number,
        this.asMergeMethod(pullRequest.repository.mergeMethod),
      );
      if (result.merged) {
        await this.prisma.gitHubPullRequest.update({
          where: { id: pullRequest.id },
          data: {
            state: 'MERGED',
            mergedAt: new Date(),
          },
        });
      }
    }
  }

  async applyManualDecision(
    user: JwtUser,
    pullRequestId: string,
    decision: 'APPROVED' | 'REJECTED',
    input: ReviewDecisionInput,
  ) {
    const { organizationId, role } = this.getOrganizationContext(user);
    this.assertReviewer(role);
    const pullRequest = await this.prisma.gitHubPullRequest.findFirst({
      where: { id: pullRequestId, organizationId },
      include: {
        repository: {
          include: {
            connection: { select: { accessToken: true } },
          },
        },
      },
    });
    if (!pullRequest) {
      throw new NotFoundException('Pull request was not found.');
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        displayName: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    });
    const actorName =
      actor?.displayName ||
      `${actor?.firstName || ''} ${actor?.lastName || ''}`.trim() ||
      actor?.email ||
      'A TaskFlow reviewer';
    const finalDecision: GitHubPRDecision =
      decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const updated = await this.prisma.gitHubPullRequest.update({
      where: { id: pullRequest.id },
      data: {
        finalDecision,
        finalDecidedById: user.sub,
        finalDecisionNote: input.note,
      },
      select: {
        id: true,
        finalDecision: true,
        finalDecisionNote: true,
        updatedAt: true,
      },
    });
    const token = this.encryption.decrypt(
      pullRequest.repository.connection.accessToken,
    );
    const comment = [
      `## TaskFlow Manual Review: ${decision === 'APPROVED' ? 'Approved' : 'Rejected'}`,
      '',
      `Overridden by **${actorName.replace(/[<>]/g, '')}**.`,
      input.note ? `\n${input.note.replace(/[<>]/g, '').slice(0, 1000)}` : '',
      '',
      '_This is an explicit human decision and supersedes the current AI recommendation._',
    ].join('\n');
    await Promise.all([
      this.api.createPullRequestComment(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.number,
        comment,
      ),
      this.api.createCommitStatus(
        token,
        pullRequest.repository.owner,
        pullRequest.repository.name,
        pullRequest.headSha,
        decision === 'APPROVED' ? 'success' : 'failure',
        `Manually ${decision.toLowerCase()} by ${actorName}`.slice(0, 140),
      ),
    ]);
    if (pullRequest.authorId && pullRequest.authorId !== user.sub) {
      await this.notifications.createNotification({
        userId: pullRequest.authorId,
        organizationId,
        type: 'GITHUB_PR_DECISION',
        title: `PR #${pullRequest.number} was ${decision.toLowerCase()}`,
        body: `${actorName} recorded a manual pull request decision.`,
        metadata: {
          pullRequestId: pullRequest.id,
          repositoryId: pullRequest.repositoryId,
          decision,
        },
      });
    }
    return serializeResponse(updated);
  }

  private async getPullRequestWithCredentials(pullRequestId: string) {
    const pullRequest = await this.prisma.gitHubPullRequest.findUnique({
      where: { id: pullRequestId },
      include: {
        repository: {
          include: {
            connection: { select: { accessToken: true } },
          },
        },
      },
    });
    if (!pullRequest) {
      throw new NotFoundException('Pull request was not found.');
    }
    return pullRequest;
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
        'Pull request decisions are restricted to reviewers.',
      );
    }
  }

  private asMergeMethod(value: string): 'merge' | 'squash' | 'rebase' {
    return value === 'merge' || value === 'rebase' ? value : 'squash';
  }
}
