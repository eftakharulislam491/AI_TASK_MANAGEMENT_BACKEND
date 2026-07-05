import { z } from 'zod';
import {
  paginationLimitValue,
  paginationPageValue,
  parseWithSchema,
  resourceIdValue,
  trimmedString,
} from '../common/utils/validation';

export const createCommentSchema = z.object({
  body: trimmedString,
});

export const updateCommentSchema = z.object({
  body: trimmedString,
});

export const listCommentsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ListCommentsQueryInput = z.infer<typeof listCommentsQuerySchema>;

export { parseWithSchema, resourceIdValue };
