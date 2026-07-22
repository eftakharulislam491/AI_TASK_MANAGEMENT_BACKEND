import { z } from 'zod';
import {
  emailValue,
  optionalTrimmedString,
  paginationLimitValue,
  paginationPageValue,
  parseWithSchema,
  resourceIdValue,
  trimmedString,
} from '../common/utils/validation';

export const requirementStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'IMPLEMENTED',
  'DEPRECATED',
]);

export const requirementPrioritySchema = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

export const requirementTypeSchema = z.enum([
  'FEATURE_REQUEST',
  'BUG_REPORT',
  'CLIENT_REQUEST',
  'REQUIREMENT_CHANGE',
  'MEETING_NOTE',
  'GENERAL',
]);

const nullableString = z.string().trim().min(1).nullable().optional();
const nullableDate = z.coerce.date().nullable().optional();

export const createRequirementSchema = z.object({
  projectId: resourceIdValue.optional(),
  title: trimmedString.max(200),
  description: optionalTrimmedString,
  type: requirementTypeSchema.default('GENERAL'),
  priority: requirementPrioritySchema.default('MEDIUM'),
  source: optionalTrimmedString,
  clientName: optionalTrimmedString,
  clientEmail: emailValue.optional(),
  expectedDelivery: z.coerce.date().optional(),
  actualDelivery: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateRequirementSchema = z
  .object({
    projectId: resourceIdValue.nullable().optional(),
    title: trimmedString.max(200).optional(),
    description: nullableString,
    type: requirementTypeSchema.optional(),
    priority: requirementPrioritySchema.optional(),
    source: nullableString,
    clientName: nullableString,
    clientEmail: emailValue.nullable().optional(),
    expectedDelivery: nullableDate,
    actualDelivery: nullableDate,
    metadata: z.record(z.string(), z.unknown()).optional(),
    changeSummary: optionalTrimmedString,
    changeNote: optionalTrimmedString,
  })
  .refine(
    (value) =>
      Object.keys(value).some(
        (key) => !['changeSummary', 'changeNote'].includes(key),
      ),
    'At least one requirement field must be provided.',
  );

export const requirementQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  status: requirementStatusSchema.optional(),
  type: requirementTypeSchema.optional(),
  priority: requirementPrioritySchema.optional(),
  projectId: resourceIdValue.optional(),
  createdById: resourceIdValue.optional(),
  search: optionalTrimmedString,
});

export const createDiscussionSchema = z.object({
  body: trimmedString.max(5000),
  parentId: resourceIdValue.optional(),
});

export const linkTaskSchema = z.object({
  taskId: resourceIdValue,
  relationType: z.enum(['implements', 'related', 'blocks']).default('related'),
});

export const rejectRequirementSchema = z.object({
  reason: trimmedString.max(1000),
});

export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;
export type UpdateRequirementInput = z.infer<typeof updateRequirementSchema>;
export type RequirementQueryInput = z.infer<typeof requirementQuerySchema>;
export type CreateDiscussionInput = z.infer<typeof createDiscussionSchema>;
export type LinkTaskInput = z.infer<typeof linkTaskSchema>;
export type RejectRequirementInput = z.infer<typeof rejectRequirementSchema>;

export { parseWithSchema, resourceIdValue };
