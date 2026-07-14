import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface';
import { RedisService } from '../common/services/redis.service';
import { TenantAccess } from '../common/decorators/tenant-access.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantAccessGuard } from '../common/guards/tenant-access.guard';
import { parseWithSchema, ragQuerySchema } from './rag.schemas';
import { RAGService } from './rag.service';

@Controller('rag')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
@TenantAccess()
export class RAGController {
  private readonly logger = new Logger(RAGController.name);

  constructor(
    private readonly ragService: RAGService,
    private readonly redisService: RedisService,
  ) {}

  @Post('ingest/tasks')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'MANAGER')
  ingestTasks(@Req() request: AuthenticatedRequest) {
    return this.ragService.ingestTasksData(
      this.getOrganizationIdFromRequest(request),
    );
  }

  @Post('ingest/projects')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN', 'MANAGER')
  ingestProjects(@Req() request: AuthenticatedRequest) {
    return this.ragService.ingestProjectsData(
      this.getOrganizationIdFromRequest(request),
    );
  }

  @Get('stats')
  getStats(@Req() request: AuthenticatedRequest) {
    return this.ragService.getStats(this.getOrganizationIdFromRequest(request));
  }

  @Post('query')
  async query(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = parseWithSchema(ragQuerySchema, body);
    const organizationId = this.getOrganizationIdFromRequest(request);
    const currentUser = this.getUserFromRequest(request);
    const historyHash = createHash('sha256')
      .update(JSON.stringify(parsed.history))
      .digest('hex');
    const cacheKey = `rag:query:${organizationId}:${currentUser.sub}:${historyHash}:${parsed.query}:${
      parsed.limit ?? 5
    }:${parsed.sourceType || 'all'}:${parsed.asJson ? 'json' : 'text'}`;
    const cachedResult = await this.getCachedAnswer(cacheKey);

    if (cachedResult) {
      return {
        message: 'Answer retrieved from cache',
        ...cachedResult,
      };
    }

    const result = await this.ragService.generateAnswer(
      organizationId,
      parsed.query,
      parsed.limit,
      parsed.sourceType,
      parsed.asJson,
      parsed.history,
      currentUser,
    );
    await this.cacheAnswer(cacheKey, result);

    return {
      message: 'Answer generated successfully.',
      ...result,
    };
  }

  private getOrganizationIdFromRequest(request: AuthenticatedRequest) {
    const organizationId =
      request.tenantContext?.organizationId ??
      request.user?.currentOrganizationId;

    if (!organizationId) {
      throw new ForbiddenException('Organization context is required.');
    }

    return organizationId;
  }

  private getUserFromRequest(request: AuthenticatedRequest) {
    if (!request.user) {
      throw new ForbiddenException('Authenticated user context is required.');
    }

    return request.user;
  }

  private async getCachedAnswer(
    cacheKey: string,
  ): Promise<Awaited<ReturnType<RAGService['generateAnswer']>> | null> {
    try {
      const cachedResult = await this.redisService.get(cacheKey);

      if (!cachedResult) {
        return null;
      }

      return JSON.parse(cachedResult) as Awaited<
        ReturnType<RAGService['generateAnswer']>
      >;
    } catch (error) {
      this.logger.warn(
        `RAG cache read failed. Continuing without cache. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async cacheAnswer(
    cacheKey: string,
    result: Awaited<ReturnType<RAGService['generateAnswer']>>,
  ) {
    try {
      await this.redisService.set(cacheKey, result, 1800);
    } catch (error) {
      this.logger.warn(
        `RAG cache write failed. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
