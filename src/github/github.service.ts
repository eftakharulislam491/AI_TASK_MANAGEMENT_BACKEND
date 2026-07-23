import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  GitHubAIReviewStatus,
  GitHubPullRequestState,
  Prisma,
  type Role,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { EncryptionService } from '../common/services/encryption.service';
import { serializeResponse } from '../common/utils/response';
import type { AppEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import {
  GitHubApiClient,
  type GitHubPullRequestSnapshot,
} from './github-api.client';
import { normalizeGitHubOrganizationSettings } from './github-settings';
import type {
  ConnectRepositoryInput,
  GitHubCallbackInput,
  GitHubWebhookInput,
  PullRequestQueryInput,
  UpdateRepositorySettingsInput,
} from './github.schemas';
import { verifyGitHubWebhookSignature } from './github-webhook-signature';

type OAuthState = {
  sub: string;
  organizationId: string;
  nonce: string;
  purpose: 'github-oauth';
};

const repositoryPublicSelect = {
  id: true,
  organizationId: true,
  projectId: true,
  githubRepositoryId: true,
  owner: true,
  name: true,
  fullName: true,
  description: true,
  defaultBranch: true,
  isPrivate: true,
  isActive: true,
  autoReviewEnabled: true,
  autoMergeOnPass: true,
  aiScoreThreshold: true,
  mergeMethod: true,
  testEnabled: true,
  testCommand: true,
  maxContextCharacters: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  _count: {
    select: {
      pullRequests: true,
    },
  },
} satisfies Prisma.GitHubRepositorySelect;

const pullRequestListSelect = {
  id: true,
  organizationId: true,
  repositoryId: true,
  number: true,
  title: true,
  htmlUrl: true,
  authorLogin: true,
  state: true,
  isDraft: true,
  headRef: true,
  headSha: true,
  baseRef: true,
  additions: true,
  deletions: true,
  changedFiles: true,
  mergeable: true,
  aiReviewStatus: true,
  aiScore: true,
  aiReviewSummary: true,
  finalDecision: true,
  testRunStatus: true,
  lastReviewHeadSha: true,
  openedAt: true,
  updatedAt: true,
  repository: {
    select: {
      id: true,
      fullName: true,
      name: true,
      owner: true,
      aiScoreThreshold: true,
      autoReviewEnabled: true,
    },
  },
  _count: {
    select: {
      files: true,
      reports: true,
    },
  },
} satisfies Prisma.GitHubPullRequestSelect;

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: GitHubApiClient,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
    private readonly queue: QueueService,
  ) {}

  async getIntegrationStatus(user: JwtUser) {
    const { organizationId, role } = this.getOrganizationContext(user);
    const [organization, connection, repositoryCount] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
      }),
      this.prisma.gitHubConnection.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: user.sub,
          },
        },
        select: {
          id: true,
          githubLogin: true,
          scopes: true,
          isActive: true,
          connectedAt: true,
        },
      }),
      this.prisma.gitHubRepository.count({
        where: { organizationId, isActive: true },
      }),
    ]);
    const settings = normalizeGitHubOrganizationSettings(
      organization?.settings,
    );
    return serializeResponse({
      ...settings,
      encryptionConfigured: this.encryption.isConfigured(),
      oauthConfigured: Boolean(
        this.config.get('GITHUB_CLIENT_ID', { infer: true }) &&
        this.config.get('GITHUB_CLIENT_SECRET', { infer: true }),
      ),
      connection:
        connection?.isActive === true
          ? {
              id: connection.id,
              githubLogin: connection.githubLogin,
              scopes: connection.scopes,
              connectedAt: connection.connectedAt,
            }
          : null,
      repositoryCount,
      canManage: this.canManage(role),
    });
  }

  async getAuthUrl(user: JwtUser) {
    const { organizationId } = await this.assertFeatureEnabled(user);
    if (!this.encryption.isConfigured()) {
      throw new BadRequestException(
        'GitHub integration needs ENCRYPTION_KEY before an account can be connected.',
      );
    }
    const clientId = this.config.get('GITHUB_CLIENT_ID', { infer: true });
    if (!clientId) {
      throw new BadRequestException('GITHUB_CLIENT_ID is not configured.');
    }
    const state = this.jwt.sign(
      {
        sub: user.sub,
        organizationId,
        nonce: randomBytes(16).toString('hex'),
        purpose: 'github-oauth',
      } satisfies OAuthState,
      { expiresIn: '10m' },
    );
    const callbackUrl = `${this.config.getOrThrow('APP_URL', {
      infer: true,
    })}/github/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: 'repo read:user user:email',
      state,
      allow_signup: 'true',
    });
    return serializeResponse({
      authUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
    });
  }

  async handleCallback(input: GitHubCallbackInput) {
    let state: OAuthState;
    try {
      state = this.jwt.verify<OAuthState>(input.state);
    } catch {
      throw new UnauthorizedException(
        'GitHub connection state is invalid or expired.',
      );
    }
    if (
      state.purpose !== 'github-oauth' ||
      !state.sub ||
      !state.organizationId ||
      !state.nonce
    ) {
      throw new UnauthorizedException('GitHub connection state is invalid.');
    }

    const [membership, user, organization] = await Promise.all([
      this.prisma.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: state.sub,
            organizationId: state.organizationId,
          },
        },
        select: { status: true },
      }),
      this.prisma.user.findUnique({
        where: { id: state.sub },
        select: { role: true },
      }),
      this.prisma.organization.findUnique({
        where: { id: state.organizationId },
        select: { settings: true },
      }),
    ]);
    if (
      !user ||
      (user.role !== 'SUPER_ADMIN' && membership?.status !== 'ACTIVE')
    ) {
      throw new ForbiddenException(
        'The GitHub connection workspace is unavailable.',
      );
    }
    if (
      !normalizeGitHubOrganizationSettings(organization?.settings)
        .githubIntegrationEnabled
    ) {
      throw new ForbiddenException(
        'GitHub integration is disabled for this organization.',
      );
    }

    const token = await this.api.exchangeOAuthCode(input.code);
    const profile = await this.api.getAuthenticatedUser(token.accessToken);
    const connection = await this.prisma.gitHubConnection.upsert({
      where: {
        organizationId_userId: {
          organizationId: state.organizationId,
          userId: state.sub,
        },
      },
      create: {
        organizationId: state.organizationId,
        userId: state.sub,
        githubUserId: profile.id,
        githubLogin: profile.login,
        accessToken: this.encryption.encrypt(token.accessToken),
        refreshToken: token.refreshToken
          ? this.encryption.encrypt(token.refreshToken)
          : undefined,
        scopes: token.scopes,
        tokenExpiresAt: token.expiresIn
          ? new Date(Date.now() + token.expiresIn * 1000)
          : undefined,
      },
      update: {
        githubUserId: profile.id,
        githubLogin: profile.login,
        accessToken: this.encryption.encrypt(token.accessToken),
        refreshToken: token.refreshToken
          ? this.encryption.encrypt(token.refreshToken)
          : null,
        scopes: token.scopes,
        tokenExpiresAt: token.expiresIn
          ? new Date(Date.now() + token.expiresIn * 1000)
          : null,
        isActive: true,
        connectedAt: new Date(),
      },
      select: {
        id: true,
        githubLogin: true,
        scopes: true,
        connectedAt: true,
      },
    });
    return serializeResponse({
      message: 'GitHub account connected.',
      connection,
    });
  }

  async disconnectConnection(user: JwtUser) {
    const { organizationId } = this.getOrganizationContext(user);
    const connection = await this.prisma.gitHubConnection.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: user.sub,
        },
      },
      include: {
        repositories: {
          where: { isActive: true },
          select: {
            id: true,
            owner: true,
            name: true,
            webhookId: true,
          },
        },
      },
    });
    if (!connection?.isActive) {
      throw new NotFoundException('No active GitHub connection was found.');
    }
    const token = this.encryption.decrypt(connection.accessToken);
    for (const repository of connection.repositories) {
      if (repository.webhookId) {
        try {
          await this.api.deleteWebhook(
            token,
            repository.owner,
            repository.name,
            repository.webhookId,
          );
        } catch (error) {
          this.logger.warn(
            `Could not remove webhook for ${repository.owner}/${repository.name}: ${this.formatError(
              error,
            )}`,
          );
        }
      }
    }
    await this.prisma.$transaction([
      this.prisma.gitHubRepository.updateMany({
        where: { organizationId, connectionId: connection.id },
        data: { isActive: false },
      }),
      this.prisma.gitHubConnection.update({
        where: { id: connection.id },
        data: { isActive: false },
      }),
    ]);
    return serializeResponse({ message: 'GitHub account disconnected.' });
  }

  async listAvailableRepositories(user: JwtUser) {
    const { organizationId, role } = await this.assertFeatureEnabled(user);
    this.assertManager(role);
    const connection = await this.getOwnConnection(organizationId, user.sub);
    const [repositories, connected] = await Promise.all([
      this.api.listRepositories(
        this.encryption.decrypt(connection.accessToken),
      ),
      this.prisma.gitHubRepository.findMany({
        where: { organizationId, isActive: true },
        select: { githubRepositoryId: true },
      }),
    ]);
    const connectedIds = new Set(
      connected.map((repository) => repository.githubRepositoryId),
    );
    return serializeResponse(
      repositories.map((repository) => ({
        ...repository,
        connected: connectedIds.has(repository.id),
      })),
    );
  }

  async connectRepository(user: JwtUser, input: ConnectRepositoryInput) {
    const { organizationId, role } = await this.assertFeatureEnabled(user);
    this.assertManager(role);
    const connection = await this.getOwnConnection(organizationId, user.sub);
    if (input.projectId) {
      await this.assertProject(organizationId, input.projectId);
    }
    const token = this.encryption.decrypt(connection.accessToken);
    const available = await this.api.listRepositories(token);
    const selected = available.find(
      (repository) => repository.id === input.githubRepositoryId,
    );
    if (!selected) {
      throw new NotFoundException(
        'Repository is unavailable to the connected GitHub account.',
      );
    }
    const existing = await this.prisma.gitHubRepository.findUnique({
      where: {
        organizationId_githubRepositoryId: {
          organizationId,
          githubRepositoryId: selected.id,
        },
      },
      select: { isActive: true },
    });
    if (existing?.isActive) {
      throw new ConflictException('Repository is already connected.');
    }

    const webhookSecret = randomBytes(32).toString('hex');
    const webhookUrl = `${this.config
      .getOrThrow('API_PUBLIC_URL', { infer: true })
      .replace(/\/$/, '')}/api/v1/github/webhook`;
    const webhookId = await this.api.createWebhook(
      token,
      selected.owner,
      selected.name,
      webhookUrl,
      webhookSecret,
    );
    let repository: Prisma.GitHubRepositoryGetPayload<{
      select: typeof repositoryPublicSelect;
    }>;
    try {
      repository = await this.prisma.gitHubRepository.upsert({
        where: {
          organizationId_githubRepositoryId: {
            organizationId,
            githubRepositoryId: selected.id,
          },
        },
        create: {
          organizationId,
          connectionId: connection.id,
          projectId: input.projectId || undefined,
          githubRepositoryId: selected.id,
          owner: selected.owner,
          name: selected.name,
          fullName: selected.fullName,
          description: selected.description,
          defaultBranch: selected.defaultBranch,
          isPrivate: selected.isPrivate,
          webhookId,
          webhookSecret: this.encryption.encrypt(webhookSecret),
        },
        update: {
          connectionId: connection.id,
          projectId: input.projectId || null,
          owner: selected.owner,
          name: selected.name,
          fullName: selected.fullName,
          description: selected.description,
          defaultBranch: selected.defaultBranch,
          isPrivate: selected.isPrivate,
          isActive: true,
          webhookId,
          webhookSecret: this.encryption.encrypt(webhookSecret),
        },
        select: repositoryPublicSelect,
      });
    } catch (error) {
      await this.api
        .deleteWebhook(token, selected.owner, selected.name, webhookId)
        .catch(() => undefined);
      throw error;
    }
    try {
      await this.syncRepositoryPullRequests(user, repository.id);
    } catch (error) {
      this.logger.warn(
        `Repository ${repository.fullName} connected, but initial pull request sync failed: ${this.formatError(
          error,
        )}`,
      );
    }
    return serializeResponse(repository);
  }

  async listRepositories(user: JwtUser) {
    const { organizationId } = await this.assertFeatureEnabled(user);
    return serializeResponse(
      await this.prisma.gitHubRepository.findMany({
        where: { organizationId, isActive: true },
        orderBy: { updatedAt: 'desc' },
        select: repositoryPublicSelect,
      }),
    );
  }

  async updateRepository(
    user: JwtUser,
    repositoryId: string,
    input: UpdateRepositorySettingsInput,
  ) {
    const { organizationId, role } = await this.assertFeatureEnabled(user);
    this.assertManager(role);
    await this.getRepository(organizationId, repositoryId);
    if (input.projectId) {
      await this.assertProject(organizationId, input.projectId);
    }
    const repository = await this.prisma.gitHubRepository.update({
      where: { id: repositoryId },
      data: {
        ...(input.projectId !== undefined
          ? { projectId: input.projectId || null }
          : {}),
        ...(input.autoReviewEnabled !== undefined
          ? { autoReviewEnabled: input.autoReviewEnabled }
          : {}),
        ...(input.autoMergeOnPass !== undefined
          ? { autoMergeOnPass: input.autoMergeOnPass }
          : {}),
        ...(input.aiScoreThreshold !== undefined
          ? { aiScoreThreshold: input.aiScoreThreshold }
          : {}),
        ...(input.mergeMethod !== undefined
          ? { mergeMethod: input.mergeMethod }
          : {}),
        ...(input.testEnabled !== undefined
          ? { testEnabled: input.testEnabled }
          : {}),
        ...(input.testCommand !== undefined
          ? { testCommand: input.testCommand || null }
          : {}),
        ...(input.maxContextCharacters !== undefined
          ? { maxContextCharacters: input.maxContextCharacters }
          : {}),
      },
      select: repositoryPublicSelect,
    });
    return serializeResponse(repository);
  }

  async disconnectRepository(user: JwtUser, repositoryId: string) {
    const { organizationId, role } = await this.assertFeatureEnabled(user);
    this.assertManager(role);
    const repository = await this.getRepository(
      organizationId,
      repositoryId,
      true,
    );
    if (repository.webhookId) {
      await this.api.deleteWebhook(
        this.encryption.decrypt(repository.connection.accessToken),
        repository.owner,
        repository.name,
        repository.webhookId,
      );
    }
    await this.prisma.gitHubRepository.update({
      where: { id: repository.id },
      data: {
        isActive: false,
        webhookId: null,
      },
    });
    return serializeResponse({
      message: 'Repository disconnected. Review history was preserved.',
    });
  }

  async syncRepositoryPullRequests(user: JwtUser, repositoryId: string) {
    const { organizationId, role } = await this.assertFeatureEnabled(user);
    this.assertManager(role);
    const repository = await this.getRepository(
      organizationId,
      repositoryId,
      true,
    );
    const token = this.encryption.decrypt(repository.connection.accessToken);
    const snapshots = await this.api.listPullRequests(
      token,
      repository.owner,
      repository.name,
    );
    const organizationSettings = normalizeGitHubOrganizationSettings(
      repository.organization.settings,
    );
    let queued = 0;
    for (const snapshot of snapshots) {
      const pullRequest = await this.upsertPullRequest(repository, snapshot);
      if (
        organizationSettings.githubAutoReviewEnabled &&
        repository.autoReviewEnabled &&
        !snapshot.draft &&
        pullRequest.lastReviewHeadSha !== snapshot.headSha
      ) {
        await this.queue.enqueueGitHubReview(
          {
            pullRequestId: pullRequest.id,
            organizationId,
            headSha: snapshot.headSha,
            trigger: 'WEBHOOK',
          },
          true,
        );
        queued += 1;
      }
    }
    await this.prisma.gitHubRepository.update({
      where: { id: repository.id },
      data: { lastSyncedAt: new Date() },
    });
    return serializeResponse({ synced: snapshots.length, queued });
  }

  async listPullRequests(user: JwtUser, query: PullRequestQueryInput) {
    const { organizationId } = await this.assertFeatureEnabled(user);
    const where: Prisma.GitHubPullRequestWhereInput = {
      organizationId,
      ...(query.repositoryId ? { repositoryId: query.repositoryId } : {}),
      ...(query.state ? { state: query.state } : {}),
      ...(query.aiReviewStatus ? { aiReviewStatus: query.aiReviewStatus } : {}),
      ...(query.search
        ? {
            OR: [
              {
                title: {
                  contains: query.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                authorLogin: {
                  contains: query.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
      repository: { isActive: true },
    };
    const [items, total] = await Promise.all([
      this.prisma.gitHubPullRequest.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: pullRequestListSelect,
      }),
      this.prisma.gitHubPullRequest.count({ where }),
    ]);
    return serializeResponse({
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }

  async getPullRequest(user: JwtUser, pullRequestId: string) {
    const { organizationId, role } = await this.assertFeatureEnabled(user);
    const pullRequest = await this.prisma.gitHubPullRequest.findFirst({
      where: { id: pullRequestId, organizationId },
      include: {
        repository: {
          select: repositoryPublicSelect,
        },
        files: {
          orderBy: [{ isReviewable: 'desc' }, { path: 'asc' }],
        },
        reports: {
          orderBy: { version: 'desc' },
          include: {
            triggeredBy: {
              select: {
                id: true,
                displayName: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        finalDecidedBy: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
    if (!pullRequest) {
      throw new NotFoundException('Pull request was not found.');
    }
    return serializeResponse({
      ...pullRequest,
      canManage: this.canManage(role),
    });
  }

  async receiveWebhook(input: {
    rawBody: Buffer;
    signature?: string;
    deliveryId?: string;
    event?: string;
    payload: GitHubWebhookInput;
  }) {
    if (!input.deliveryId || !input.event) {
      throw new BadRequestException(
        'GitHub delivery and event headers are required.',
      );
    }
    const candidates = await this.prisma.gitHubRepository.findMany({
      where: {
        githubRepositoryId: input.payload.repository.id,
        isActive: true,
      },
      include: {
        connection: { select: { githubLogin: true } },
        organization: { select: { settings: true } },
      },
    });
    if (!candidates.length) {
      throw new NotFoundException('Webhook repository is not connected.');
    }
    const repository = candidates.find((candidate) =>
      verifyGitHubWebhookSignature(
        input.rawBody,
        input.signature,
        this.encryption.decrypt(candidate.webhookSecret),
      ),
    );
    if (!repository) {
      throw new UnauthorizedException('GitHub webhook signature is invalid.');
    }

    try {
      await this.prisma.gitHubWebhookDelivery.create({
        data: {
          deliveryId: input.deliveryId,
          organizationId: repository.organizationId,
          repositoryId: repository.id,
          event: input.event,
          action: input.payload.action,
          headSha: input.payload.pull_request?.head.sha,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return serializeResponse({ accepted: true, duplicate: true });
      }
      throw error;
    }

    try {
      if (input.event === 'pull_request' && input.payload.pull_request) {
        const snapshot = this.webhookToSnapshot(input.payload);
        const pullRequest = await this.upsertPullRequest(repository, snapshot);
        const reviewActions = new Set(['opened', 'synchronize', 'reopened']);
        const settings = normalizeGitHubOrganizationSettings(
          repository.organization.settings,
        );
        if (
          input.payload.action &&
          reviewActions.has(input.payload.action) &&
          settings.githubIntegrationEnabled &&
          settings.githubAutoReviewEnabled &&
          repository.autoReviewEnabled &&
          !snapshot.draft
        ) {
          await this.queue.enqueueGitHubReview(
            {
              pullRequestId: pullRequest.id,
              organizationId: repository.organizationId,
              headSha: snapshot.headSha,
              trigger: 'WEBHOOK',
              deliveryId: input.deliveryId,
            },
            true,
          );
        }
      }
      await this.prisma.gitHubWebhookDelivery.update({
        where: { deliveryId: input.deliveryId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return serializeResponse({ accepted: true, duplicate: false });
    } catch (error) {
      await this.prisma.gitHubWebhookDelivery.update({
        where: { deliveryId: input.deliveryId },
        data: {
          status: 'FAILED',
          errorMessage: this.formatError(error).slice(0, 1000),
          processedAt: new Date(),
        },
      });
      throw error;
    }
  }

  getOrganizationContext(user: JwtUser) {
    const organizationId = user.currentOrganizationId || undefined;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required.');
    }
    if (user.role === 'SUPER_ADMIN') {
      return { organizationId, role: 'SUPER_ADMIN' as Role };
    }
    const role = user.memberships.find(
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

  canManage(role: Role) {
    return ['SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER'].includes(role);
  }

  private async assertFeatureEnabled(user: JwtUser) {
    const context = this.getOrganizationContext(user);
    const organization = await this.prisma.organization.findUnique({
      where: { id: context.organizationId },
      select: { settings: true },
    });
    if (!organization) {
      throw new NotFoundException('Organization was not found.');
    }
    const settings = normalizeGitHubOrganizationSettings(organization.settings);
    if (!settings.githubIntegrationEnabled) {
      throw new ForbiddenException(
        'GitHub integration is disabled for this organization.',
      );
    }
    return context;
  }

  private assertManager(role: Role) {
    if (!this.canManage(role)) {
      throw new ForbiddenException(
        'GitHub repository management is restricted to reviewers.',
      );
    }
  }

  private async getOwnConnection(organizationId: string, userId: string) {
    const connection = await this.prisma.gitHubConnection.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
    });
    if (!connection?.isActive) {
      throw new BadRequestException('Connect a GitHub account first.');
    }
    return connection;
  }

  private async getRepository(
    organizationId: string,
    repositoryId: string,
    withCredentials: true,
  ): Promise<
    Prisma.GitHubRepositoryGetPayload<{
      include: {
        connection: { select: { accessToken: true } };
        organization: { select: { settings: true } };
      };
    }>
  >;
  private async getRepository(
    organizationId: string,
    repositoryId: string,
    withCredentials?: false,
  ): Promise<Prisma.GitHubRepositoryGetPayload<Record<string, never>>>;
  private async getRepository(
    organizationId: string,
    repositoryId: string,
    withCredentials = false,
  ) {
    const repository = await this.prisma.gitHubRepository.findFirst({
      where: { id: repositoryId, organizationId, isActive: true },
      ...(withCredentials
        ? {
            include: {
              connection: { select: { accessToken: true } },
              organization: { select: { settings: true } },
            },
          }
        : {}),
    });
    if (!repository) {
      throw new NotFoundException('Connected repository was not found.');
    }
    return repository;
  }

  private async assertProject(organizationId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Linked project was not found.');
    }
  }

  private async upsertPullRequest(
    repository: {
      id: string;
      organizationId: string;
    },
    snapshot: GitHubPullRequestSnapshot,
  ) {
    const authorConnection = await this.prisma.gitHubConnection.findFirst({
      where: {
        organizationId: repository.organizationId,
        githubLogin: {
          equals: snapshot.authorLogin,
          mode: Prisma.QueryMode.insensitive,
        },
        isActive: true,
      },
      select: { userId: true },
    });
    const state: GitHubPullRequestState = snapshot.merged
      ? 'MERGED'
      : snapshot.state === 'closed'
        ? 'CLOSED'
        : 'OPEN';
    const existing = await this.prisma.gitHubPullRequest.findUnique({
      where: {
        repositoryId_number: {
          repositoryId: repository.id,
          number: snapshot.number,
        },
      },
      select: { id: true, headSha: true, lastReviewHeadSha: true },
    });
    const headChanged = existing?.headSha !== snapshot.headSha;
    const pullRequest = await this.prisma.gitHubPullRequest.upsert({
      where: {
        repositoryId_number: {
          repositoryId: repository.id,
          number: snapshot.number,
        },
      },
      create: {
        organizationId: repository.organizationId,
        repositoryId: repository.id,
        githubPullRequestId: snapshot.id,
        number: snapshot.number,
        title: snapshot.title,
        body: snapshot.body,
        htmlUrl: snapshot.htmlUrl,
        authorLogin: snapshot.authorLogin,
        authorId: authorConnection?.userId,
        state,
        isDraft: snapshot.draft,
        baseRef: snapshot.baseRef,
        baseSha: snapshot.baseSha,
        headRef: snapshot.headRef,
        headSha: snapshot.headSha,
        additions: snapshot.additions,
        deletions: snapshot.deletions,
        changedFiles: snapshot.changedFiles,
        mergeable: snapshot.mergeable,
        aiReviewStatus: 'PENDING',
        openedAt: new Date(snapshot.createdAt),
        closedAt: snapshot.closedAt ? new Date(snapshot.closedAt) : undefined,
        mergedAt: snapshot.mergedAt ? new Date(snapshot.mergedAt) : undefined,
      },
      update: {
        title: snapshot.title,
        body: snapshot.body,
        htmlUrl: snapshot.htmlUrl,
        authorLogin: snapshot.authorLogin,
        authorId: authorConnection?.userId || null,
        state,
        isDraft: snapshot.draft,
        baseRef: snapshot.baseRef,
        baseSha: snapshot.baseSha,
        headRef: snapshot.headRef,
        headSha: snapshot.headSha,
        additions: snapshot.additions,
        deletions: snapshot.deletions,
        changedFiles: snapshot.changedFiles,
        mergeable: snapshot.mergeable,
        closedAt: snapshot.closedAt ? new Date(snapshot.closedAt) : null,
        mergedAt: snapshot.mergedAt ? new Date(snapshot.mergedAt) : null,
        ...(headChanged && state === 'OPEN'
          ? {
              aiReviewStatus: GitHubAIReviewStatus.PENDING,
              aiScore: null,
              aiReviewSummary: null,
              finalDecision: 'PENDING',
              finalDecidedById: null,
              finalDecisionNote: null,
              lastReviewError: null,
            }
          : {}),
      },
      select: {
        id: true,
        headSha: true,
        lastReviewHeadSha: true,
      },
    });
    return pullRequest;
  }

  private webhookToSnapshot(
    payload: GitHubWebhookInput,
  ): GitHubPullRequestSnapshot {
    const pull = payload.pull_request;
    if (!pull) {
      throw new BadRequestException(
        'Pull request webhook payload is incomplete.',
      );
    }
    return {
      id: pull.id,
      number: pull.number,
      title: pull.title,
      body: pull.body,
      htmlUrl: pull.html_url,
      authorLogin: pull.user?.login || 'unknown',
      state: pull.state,
      merged: pull.merged,
      draft: pull.draft,
      baseRef: pull.base.ref,
      baseSha: pull.base.sha,
      headRef: pull.head.ref,
      headSha: pull.head.sha,
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changed_files,
      mergeable: pull.mergeable ?? null,
      createdAt: pull.created_at,
      closedAt: pull.closed_at || null,
      mergedAt: pull.merged_at || null,
    };
  }

  private formatError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
