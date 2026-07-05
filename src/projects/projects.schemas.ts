import { z } from 'zod';
import {
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

export const projectStatusSchema = z.enum([
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
]);

export const createProjectSchema = z.object({
  name: trimmedString,
  slug: slugValue,
  description: optionalTrimmedString,
  teamId: resourceIdValue.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: projectStatusSchema.optional(),
});

export const addProjectMemberSchema = z.object({
  userId: resourceIdValue,
});

export const listProjectsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  search: optionalTrimmedString,
  status: projectStatusSchema.optional(),
  teamId: resourceIdValue.optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type ListProjectsQueryInput = z.infer<typeof listProjectsQuerySchema>;

export { parseWithSchema, resourceIdValue };
