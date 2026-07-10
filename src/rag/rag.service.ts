import { BadGatewayException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { IndexingService } from './indexing.service';
import { LLMService } from './llm.service';
import type { RagSourceType } from './rag.schemas';

type RetrievedDocument = {
  id: string;
  organizationId: string;
  chunkKey: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string | null;
  content: string;
  metadata: unknown;
  similarity: number;
};

@Injectable()
export class RAGService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly indexingService: IndexingService,
    private readonly llmService: LLMService,
    private readonly prisma: PrismaService,
  ) {}

  ingestTasksData(organizationId: string) {
    return this.indexingService.indexTasksData(organizationId);
  }

  ingestProjectsData(organizationId: string) {
    return this.indexingService.indexProjectsData(organizationId);
  }

  async retrieveRelevantDocuments(
    organizationId: string,
    query: string,
    limit = 5,
    sourceType?: RagSourceType,
  ) {
    const queryEmbedding = await this.embeddingService.generateEmbedding(query);
    const vectorLiteral = this.indexingService.toVectorLiteral(queryEmbedding);

    return this.prisma.$queryRaw<RetrievedDocument[]>(
      Prisma.sql`
        SELECT
          "id"::text,
          "organizationId",
          "chunkKey",
          "sourceType",
          "sourceId",
          "sourceLabel",
          "content",
          "metadata",
          1 - ("embedding" <=> CAST(${vectorLiteral} AS vector)) AS "similarity"
        FROM "document_embeddings"
        WHERE
          "organizationId" = ${organizationId}
          AND "isDeleted" = false
          AND "embedding" IS NOT NULL
          ${sourceType ? Prisma.sql`AND "sourceType" = ${sourceType}` : Prisma.empty}
        ORDER BY "embedding" <=> CAST(${vectorLiteral} AS vector)
        LIMIT ${limit}
      `,
    );
  }

  async generateAnswer(
    organizationId: string,
    query: string,
    limit = 5,
    sourceType?: RagSourceType,
    asJson = false,
  ) {
    const documents = await this.retrieveRelevantDocuments(
      organizationId,
      query,
      limit,
      sourceType,
    );
    const context = documents.map((document) => document.content);
    const rawAnswer = await this.llmService.generateResponse(
      query,
      context,
      asJson,
    );
    const answer = asJson ? this.parseJsonAnswer(rawAnswer) : rawAnswer;

    return {
      answer,
      sources: documents.map((document) => ({
        id: document.id,
        chunkKey: document.chunkKey,
        sourceType: document.sourceType,
        sourceId: document.sourceId,
        sourceLabel: document.sourceLabel,
        similarity: Number(document.similarity),
        metadata: document.metadata,
      })),
      contextUsed: context.length,
    };
  }

  async getStats(organizationId: string) {
    const [totalRows, breakdownRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*)::bigint AS "count"
          FROM "document_embeddings"
          WHERE "organizationId" = ${organizationId}
            AND "isDeleted" = false
        `,
      ),
      this.prisma.$queryRaw<Array<{ sourceType: string; count: bigint }>>(
        Prisma.sql`
          SELECT "sourceType", COUNT(*)::bigint AS "count"
          FROM "document_embeddings"
          WHERE "organizationId" = ${organizationId}
            AND "isDeleted" = false
          GROUP BY "sourceType"
          ORDER BY "sourceType" ASC
        `,
      ),
    ]);

    return {
      totalActiveDocuments: Number(totalRows[0]?.count ?? 0),
      sourceTypeBreakdown: breakdownRows.reduce<Record<string, number>>(
        (breakdown, row) => ({
          ...breakdown,
          [row.sourceType]: Number(row.count),
        }),
        {},
      ),
      timestamp: new Date().toISOString(),
    };
  }

  private parseJsonAnswer(rawAnswer: string) {
    const cleaned = rawAnswer
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned) as unknown;
    } catch {
      throw new BadGatewayException(
        'LLM response was not valid JSON after cleanup.',
      );
    }
  }
}
