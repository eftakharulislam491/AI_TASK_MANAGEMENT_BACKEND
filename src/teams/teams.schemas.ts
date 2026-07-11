import { z } from 'zod';
import {
  booleanQueryValue,
  optionalTrimmedString,
  paginationLimitValue,
  paginationPageValue,
  parseWithSchema,
  resourceIdValue,
  trimmedString,
} from '../common/utils/validation';

const slugValue = trimmedString.regex(
  /^[a-z0-9-]+$/,
  'Slug must be lowercase alphanumeric with hyphens',
);

export const createTeamSchema = z.object({
  name: trimmedString,
  slug: slugValue,
  description: optionalTrimmedString,
  leaderId: z.union([resourceIdValue, z.null()]).optional(),
});

export const updateTeamSchema = createTeamSchema.partial();

export const addTeamMemberSchema = z.object({
  userId: resourceIdValue,
});

export const listTeamsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  search: optionalTrimmedString,
  isActive: booleanQueryValue.optional(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type ListTeamsQueryInput = z.infer<typeof listTeamsQuerySchema>;

export { parseWithSchema, resourceIdValue };
