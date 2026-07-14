-- The configured NVIDIA embedding model emits 2048-dimensional vectors.
-- Existing 1536-dimensional values cannot be converted and must be re-indexed.
UPDATE "document_embeddings"
SET
  "embedding" = NULL,
  "isDeleted" = true,
  "deletedAt" = NOW(),
  "updatedAt" = NOW()
WHERE "embedding" IS NOT NULL;

ALTER TABLE "document_embeddings"
ALTER COLUMN "embedding" TYPE vector(2048)
USING NULL::vector(2048);
