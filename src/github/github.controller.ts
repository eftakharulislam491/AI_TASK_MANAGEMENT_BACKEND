import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtUser } from '../auth/interfaces/jwt-user.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import { parseWithSchema } from '../common/utils/validation';
import { GitHubDecisionService } from './github-decision.service';
import { GitHubReviewService } from './github-review.service';
import {
  connectRepositorySchema,
  pullRequestQuerySchema,
  resourceIdValue,
  reviewDecisionSchema,
  updateRepositorySettingsSchema,
} from './github.schemas';
import { GitHubService } from './github.service';

@Controller('github')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class GitHubController {
  constructor(
    private readonly github: GitHubService,
    private readonly reviews: GitHubReviewService,
    private readonly decisions: GitHubDecisionService,
  ) {}

  @Get('status')
  status(@CurrentUser() user: JwtUser) {
    return this.github.getIntegrationStatus(user);
  }

  @Get('auth-url')
  authUrl(@CurrentUser() user: JwtUser) {
    return this.github.getAuthUrl(user);
  }

  @Delete('connection')
  disconnectConnection(@CurrentUser() user: JwtUser) {
    return this.github.disconnectConnection(user);
  }

  @Get('repositories/available')
  availableRepositories(@CurrentUser() user: JwtUser) {
    return this.github.listAvailableRepositories(user);
  }

  @Get('repositories')
  repositories(@CurrentUser() user: JwtUser) {
    return this.github.listRepositories(user);
  }

  @Post('repositories')
  connectRepository(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.github.connectRepository(
      user,
      parseWithSchema(connectRepositorySchema, body),
    );
  }

  @Patch('repositories/:repositoryId')
  updateRepository(
    @CurrentUser() user: JwtUser,
    @Param('repositoryId') repositoryId: string,
    @Body() body: unknown,
  ) {
    return this.github.updateRepository(
      user,
      parseWithSchema(resourceIdValue, repositoryId),
      parseWithSchema(updateRepositorySettingsSchema, body),
    );
  }

  @Delete('repositories/:repositoryId')
  disconnectRepository(
    @CurrentUser() user: JwtUser,
    @Param('repositoryId') repositoryId: string,
  ) {
    return this.github.disconnectRepository(
      user,
      parseWithSchema(resourceIdValue, repositoryId),
    );
  }

  @Post('repositories/:repositoryId/sync')
  syncRepository(
    @CurrentUser() user: JwtUser,
    @Param('repositoryId') repositoryId: string,
  ) {
    return this.github.syncRepositoryPullRequests(
      user,
      parseWithSchema(resourceIdValue, repositoryId),
    );
  }

  @Get('pull-requests')
  pullRequests(@CurrentUser() user: JwtUser, @Query() query: unknown) {
    return this.github.listPullRequests(
      user,
      parseWithSchema(pullRequestQuerySchema, query),
    );
  }

  @Get('pull-requests/:pullRequestId')
  pullRequest(
    @CurrentUser() user: JwtUser,
    @Param('pullRequestId') pullRequestId: string,
  ) {
    return this.github.getPullRequest(
      user,
      parseWithSchema(resourceIdValue, pullRequestId),
    );
  }

  @Post('pull-requests/:pullRequestId/review')
  review(
    @CurrentUser() user: JwtUser,
    @Param('pullRequestId') pullRequestId: string,
  ) {
    return this.reviews.requestReview(
      user,
      parseWithSchema(resourceIdValue, pullRequestId),
    );
  }

  @Post('pull-requests/:pullRequestId/approve')
  approve(
    @CurrentUser() user: JwtUser,
    @Param('pullRequestId') pullRequestId: string,
    @Body() body: unknown,
  ) {
    return this.decisions.applyManualDecision(
      user,
      parseWithSchema(resourceIdValue, pullRequestId),
      'APPROVED',
      parseWithSchema(reviewDecisionSchema, body),
    );
  }

  @Post('pull-requests/:pullRequestId/reject')
  reject(
    @CurrentUser() user: JwtUser,
    @Param('pullRequestId') pullRequestId: string,
    @Body() body: unknown,
  ) {
    return this.decisions.applyManualDecision(
      user,
      parseWithSchema(resourceIdValue, pullRequestId),
      'REJECTED',
      parseWithSchema(reviewDecisionSchema, body),
    );
  }
}
