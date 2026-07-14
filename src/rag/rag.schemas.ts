import { z } from 'zod';
import {
  parseWithSchema,
  resourceIdValue,
  trimmedString,
} from '../common/utils/validation';

export const ragSourceTypeSchema = z.enum(['TASK', 'PROJECT']);

const ragHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: trimmedString.max(8000),
});

export const ragQuerySchema = z.object({
  query: trimmedString,
  limit: z.coerce.number().int().min(1).max(20).default(5),
  sourceType: ragSourceTypeSchema.optional(),
  asJson: z.coerce.boolean().default(false),
  history: z.array(ragHistoryMessageSchema).max(12).default([]),
});

export const ragRetrieveQuerySchema = z.object({
  query: trimmedString,
  limit: z.coerce.number().int().min(1).max(20).default(5),
  sourceType: ragSourceTypeSchema.optional(),
});

export type RagQueryInput = z.infer<typeof ragQuerySchema>;
export type RagRetrieveQueryInput = z.infer<typeof ragRetrieveQuerySchema>;
export type RagSourceType = z.infer<typeof ragSourceTypeSchema>;

export { parseWithSchema, resourceIdValue };
