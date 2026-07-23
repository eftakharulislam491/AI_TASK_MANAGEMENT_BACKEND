import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env';
import type { GitHubChangedFile } from './github-context-planner';

export type GitHubRepositorySummary = {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  isPrivate: boolean;
  htmlUrl: string;
};

export type GitHubPullRequestSnapshot = {
  id: string;
  number: number;
  title: string;
  body: string | null;
  htmlUrl: string;
  authorLogin: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: boolean | null;
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
};

@Injectable()
export class GitHubApiClient {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async exchangeOAuthCode(code: string) {
    const clientId = this.requireConfig('GITHUB_CLIENT_ID');
    const clientSecret = this.requireConfig('GITHUB_CLIENT_SECRET');
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error_description?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new BadGatewayException(
        payload.error_description || 'GitHub OAuth token exchange failed.',
      );
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
      scopes: payload.scope?.split(',').filter(Boolean) || [],
    };
  }

  async getAuthenticatedUser(token: string) {
    const octokit = await this.createClient(token);
    const { data } = await octokit.rest.users.getAuthenticated();
    return {
      id: String(data.id),
      login: data.login,
    };
  }

  async listRepositories(token: string): Promise<GitHubRepositorySummary[]> {
    const octokit = await this.createClient(token);
    const repositories = await octokit.paginate(
      octokit.rest.repos.listForAuthenticatedUser,
      {
        affiliation: 'owner,collaborator,organization_member',
        sort: 'updated',
        per_page: 100,
      },
    );
    return repositories.map((repository) => ({
      id: String(repository.id),
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      description: repository.description,
      defaultBranch: repository.default_branch,
      isPrivate: repository.private,
      htmlUrl: repository.html_url,
    }));
  }

  async createWebhook(
    token: string,
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string,
  ) {
    const octokit = await this.createClient(token);
    const { data } = await octokit.rest.repos.createWebhook({
      owner,
      repo,
      active: true,
      events: ['pull_request'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        insecure_ssl: '0',
        secret,
      },
    });
    return String(data.id);
  }

  async deleteWebhook(
    token: string,
    owner: string,
    repo: string,
    webhookId: string,
  ) {
    const octokit = await this.createClient(token);
    await octokit.rest.repos.deleteWebhook({
      owner,
      repo,
      hook_id: Number(webhookId),
    });
  }

  async listPullRequests(
    token: string,
    owner: string,
    repo: string,
  ): Promise<GitHubPullRequestSnapshot[]> {
    const octokit = await this.createClient(token);
    const pulls = await octokit.paginate(octokit.rest.pulls.list, {
      owner,
      repo,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    });
    return Promise.all(
      pulls.map((pull) => this.getPullRequest(token, owner, repo, pull.number)),
    );
  }

  async getPullRequest(
    token: string,
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullRequestSnapshot> {
    const octokit = await this.createClient(token);
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
    });
    return {
      id: String(data.id),
      number: data.number,
      title: data.title,
      body: data.body,
      htmlUrl: data.html_url,
      authorLogin: data.user?.login || 'unknown',
      state: data.state,
      merged: data.merged,
      draft: data.draft || false,
      baseRef: data.base.ref,
      baseSha: data.base.sha,
      headRef: data.head.ref,
      headSha: data.head.sha,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
      mergeable: data.mergeable,
      createdAt: data.created_at,
      closedAt: data.closed_at,
      mergedAt: data.merged_at,
    };
  }

  async listPullRequestFiles(
    token: string,
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubChangedFile[]> {
    const octokit = await this.createClient(token);
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    });
    return files.map((file) => ({
      filename: file.filename,
      previous_filename: file.previous_filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    }));
  }

  async getFileContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const octokit = await this.createClient(token);
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });
      if (
        Array.isArray(data) ||
        !('content' in data) ||
        typeof data.content !== 'string'
      ) {
        return null;
      }
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      if (this.getStatus(error) === 404) return null;
      throw error;
    }
  }

  async createPullRequestComment(
    token: string,
    owner: string,
    repo: string,
    number: number,
    body: string,
  ) {
    const octokit = await this.createClient(token);
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: body.slice(0, 60000),
    });
  }

  async createCommitStatus(
    token: string,
    owner: string,
    repo: string,
    sha: string,
    state: 'error' | 'failure' | 'pending' | 'success',
    description: string,
    targetUrl?: string,
  ) {
    const octokit = await this.createClient(token);
    await octokit.rest.repos.createCommitStatus({
      owner,
      repo,
      sha,
      state,
      description: description.slice(0, 140),
      context: 'TaskFlow AI Review',
      target_url: targetUrl,
    });
  }

  async mergePullRequest(
    token: string,
    owner: string,
    repo: string,
    number: number,
    method: 'merge' | 'squash' | 'rebase',
  ) {
    const octokit = await this.createClient(token);
    const { data } = await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: number,
      merge_method: method,
    });
    return { merged: data.merged, message: data.message };
  }

  private async createClient(token: string) {
    const [{ Octokit }, { throttling }] = await Promise.all([
      import('@octokit/rest'),
      import('@octokit/plugin-throttling'),
    ]);
    const ThrottledOctokit = Octokit.plugin(throttling);
    return new ThrottledOctokit({
      auth: token,
      request: { timeout: 20000 },
      throttle: {
        onRateLimit: (retryAfter, options, _octokit, retryCount) => {
          return retryCount < 2;
        },
        onSecondaryRateLimit: (retryAfter, options, _octokit, retryCount) => {
          return retryCount < 2;
        },
      },
    });
  }

  private requireConfig(key: 'GITHUB_CLIENT_ID' | 'GITHUB_CLIENT_SECRET') {
    const value = this.config.get(key, { infer: true });
    if (!value) {
      throw new ServiceUnavailableException(
        `${key} is required for GitHub OAuth.`,
      );
    }
    return value;
  }

  private getStatus(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      typeof error.status === 'number'
    ) {
      return error.status;
    }
    return undefined;
  }
}
