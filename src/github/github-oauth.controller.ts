import { Controller, Get, Query } from '@nestjs/common';
import { parseWithSchema } from '../common/utils/validation';
import { githubCallbackSchema } from './github.schemas';
import { GitHubService } from './github.service';

@Controller('github')
export class GitHubOAuthController {
  constructor(private readonly github: GitHubService) {}

  @Get('callback')
  callback(@Query() query: unknown) {
    return this.github.handleCallback(
      parseWithSchema(githubCallbackSchema, query),
    );
  }
}
