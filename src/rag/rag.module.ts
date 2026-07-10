import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { RedisService } from '../common/services/redis.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingService } from './embedding.service';
import { IndexingService } from './indexing.service';
import { LLMService } from './llm.service';
import { RAGController } from './rag.controller';
import { RAGService } from './rag.service';

@Module({
  imports: [AuthModule, ConfigModule, PrismaModule],
  controllers: [RAGController],
  providers: [
    RedisService,
    EmbeddingService,
    IndexingService,
    LLMService,
    RAGService,
  ],
  exports: [RAGService],
})
export class RAGModule {}
