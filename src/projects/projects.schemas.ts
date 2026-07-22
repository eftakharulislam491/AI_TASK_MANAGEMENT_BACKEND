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

export const projectLeaveRequestStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELED',
]);

export const createProjectSchema = z.object({
  teamId: resourceIdValue.optional(),
  name: trimmedString,
  slug: slugValue,
  description: optionalTrimmedString,
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
  status: projectStatusSchema.optional(),
  teamId: resourceIdValue.optional(),
  ownerId: resourceIdValue.optional(),
  search: optionalTrimmedString,
});

export const createProjectLeaveRequestSchema = z.object({
  reason: trimmedString,
});

export const listProjectLeaveRequestsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  scope: z.enum(['mine', 'pending', 'all']).default('mine'),
  status: projectLeaveRequestStatusSchema.optional(),
  projectId: resourceIdValue.optional(),
});

export const reviewProjectLeaveRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: optionalTrimmedString,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type ListProjectsQueryInput = z.infer<typeof listProjectsQuerySchema>;
export type CreateProjectLeaveRequestInput = z.infer<
  typeof createProjectLeaveRequestSchema
>;
export type ListProjectLeaveRequestsQueryInput = z.infer<
  typeof listProjectLeaveRequestsQuerySchema
>;
export type ReviewProjectLeaveRequestInput = z.infer<
  typeof reviewProjectLeaveRequestSchema
>;

export { parseWithSchema, resourceIdValue };
