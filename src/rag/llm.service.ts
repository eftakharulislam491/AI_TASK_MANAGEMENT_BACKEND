import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env';

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
};

@Injectable()
export class LLMService {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly appUrl: string;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {
    this.apiKey = this.configService.get('OPENROUTER_API_KEY', {
      infer: true,
    });
    this.model = this.configService.getOrThrow('OPENROUTER_LLM_MODEL', {
      infer: true,
    });
    this.appUrl = this.configService.getOrThrow('APP_URL', { infer: true });
  }

  async generateResponse(
    prompt: string,
    context: string[],
    asJson = false,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY is not configured.',
      );
    }

    const fullPrompt = [
      `Context information:\n${context.join('\n\n')}`,
      `Question: ${prompt}`,
      'Answer based on the context above.',
      asJson ? 'Return only valid JSON. Do not use markdown code fences.' : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.appUrl,
          'X-Title': 'TaskFlow RAG',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a precise assistant for a task management platform. Use only the provided context and say when context is insufficient.',
            },
            {
              role: 'user',
              content: fullPrompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 1500,
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as
      | OpenRouterChatResponse
      | Record<string, never>;

    if (!response.ok) {
      throw new BadGatewayException(
        `OpenRouter chat request failed: ${
          'error' in payload && payload.error?.message
            ? payload.error.message
            : response.statusText
        }`,
      );
    }

    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
      throw new BadGatewayException(
        'OpenRouter chat response did not include message content.',
      );
    }

    return content;
  }
}
