import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env';

type OpenRouterEmbeddingResponse = {
  data?: Array<{
    embedding?: unknown;
  }>;
  error?: {
    message?: string;
  };
};

@Injectable()
export class EmbeddingService {
  private readonly apiKey?: string;
  private readonly embeddingModel: string;

  constructor(private readonly configService: ConfigService<AppEnv, true>) {
    this.apiKey = this.configService.get('OPENROUTER_API_KEY', {
      infer: true,
    });
    this.embeddingModel = this.configService.getOrThrow(
      'OPENROUTER_EMBEDDING_MODEL',
      { infer: true },
    );
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new InternalServerErrorException(
        'OPENROUTER_API_KEY is not configured.',
      );
    }

    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: this.embeddingModel,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as
      | OpenRouterEmbeddingResponse
      | Record<string, never>;

    if (!response.ok) {
      throw new BadGatewayException(
        `OpenRouter embedding request failed: ${
          'error' in payload && payload.error?.message
            ? payload.error.message
            : response.statusText
        }`,
      );
    }

    const embedding = payload.data?.[0]?.embedding;

    if (
      !Array.isArray(embedding) ||
      !embedding.every((value) => typeof value === 'number')
    ) {
      throw new BadGatewayException(
        'OpenRouter embedding response did not include a numeric embedding.',
      );
    }

    if (embedding.length !== 1536) {
      throw new BadGatewayException(
        `Expected 1536-dimensional embedding, received ${embedding.length}.`,
      );
    }

    return embedding;
  }
}
