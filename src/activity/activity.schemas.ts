import { z } from 'zod';
import {
  optionalTrimmedString,
  paginationLimitValue,
  paginationPageValue,
  parseWithSchema,
  resourceIdValue,
} from '../common/utils/validation';

export const listActivityQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  action: optionalTrimmedString,
  actorId: resourceIdValue.optional(),
  taskId: resourceIdValue.optional(),
  projectId: resourceIdValue.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const listTaskActivityQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  action: optionalTrimmedString,
  actorId: resourceIdValue.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListActivityQueryInput = z.infer<typeof listActivityQuerySchema>;
export type ListTaskActivityQueryInput = z.infer<
  typeof listTaskActivityQuerySchema
>;

export { parseWithSchema, resourceIdValue };
