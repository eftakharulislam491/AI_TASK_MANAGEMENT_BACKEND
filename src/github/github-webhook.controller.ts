import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { parseWithSchema } from '../common/utils/validation';
import { githubWebhookSchema } from './github.schemas';
import { GitHubService } from './github.service';

@Controller('github')
export class GitHubWebhookController {
  constructor(private readonly github: GitHubService) {}

  @Post('webhook')
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-github-delivery') deliveryId?: string,
    @Headers('x-github-event') event?: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('Raw webhook body is unavailable.');
    }
    return this.github.receiveWebhook({
      rawBody: request.rawBody,
      signature,
      deliveryId,
      event,
      payload: parseWithSchema(githubWebhookSchema, body),
    });
  }
}
