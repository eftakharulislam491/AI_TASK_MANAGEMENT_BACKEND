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

export const createProjectLeaveRequestSchema = z.object({
  reason: trimmedString.max(1000),
});

export const listProjectLeaveRequestsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  status: projectLeaveRequestStatusSchema.optional(),
  projectId: resourceIdValue.optional(),
  requesterId: resourceIdValue.optional(),
  scope: z.enum(['mine', 'pending', 'all']).default('mine'),
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
