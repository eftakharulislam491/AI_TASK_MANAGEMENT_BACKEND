-- EnableExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "document_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" TEXT NOT NULL,
    "chunkKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1536),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_embeddings_chunkKey_key" ON "document_embeddings"("chunkKey");

-- CreateIndex
CREATE INDEX "document_embeddings_organizationId_sourceType_isDeleted_idx" ON "document_embeddings"("organizationId", "sourceType", "isDeleted");

-- CreateIndex
CREATE INDEX "document_embeddings_sourceId_idx" ON "document_embeddings"("sourceId");

-- CreateIndex
CREATE INDEX "document_embeddings_embedding_idx"
ON "document_embeddings"
USING ivfflat ("embedding" vector_cosine_ops)
WITH (lists = 100);

-- AddForeignKey
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
