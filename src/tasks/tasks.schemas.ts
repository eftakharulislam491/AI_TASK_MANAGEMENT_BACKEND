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

export const taskStatusSchema = z.enum([
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'CANCELLED',
]);

export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

const tagsValue = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return value;
}, z.array(trimmedString).default([]));

const optionalAssigneeValue = z
  .union([resourceIdValue, z.literal(''), z.null()])
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const createTaskSchema = z.object({
  projectId: resourceIdValue.optional(),
  title: trimmedString,
  description: optionalTrimmedString,
  priority: taskPrioritySchema.default('MEDIUM'),
  assigneeId: optionalAssigneeValue,
  deadline: z.coerce.date().optional(),
  estimatedHours: z.coerce.number().positive().optional(),
  tags: tagsValue,
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  status: taskStatusSchema.optional(),
});

export const updateTaskStatusSchema = z.object({
  status: taskStatusSchema,
});

export const assignTaskSchema = z.object({
  assigneeId: z
    .union([resourceIdValue, z.literal(''), z.null()])
    .transform((value) => (value === '' ? null : value)),
  aiAssigned: z.boolean().default(false),
  confidence: z.coerce.number().int().min(0).max(100).nullable().optional(),
});

export const createReassignmentRequestSchema = z.object({
  reason: trimmedString.pipe(z.string().min(10).max(1000)),
});

export const reviewReassignmentRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: optionalTrimmedString,
});

export const listReassignmentRequestsSchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const listTasksQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  projectId: resourceIdValue.optional(),
  assigneeId: resourceIdValue.optional(),
  reporterId: resourceIdValue.optional(),
  isOverdue: booleanQueryValue.optional(),
  search: optionalTrimmedString,
  tags: tagsValue.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
export type CreateReassignmentRequestInput = z.infer<
  typeof createReassignmentRequestSchema
>;
export type ReviewReassignmentRequestInput = z.infer<
  typeof reviewReassignmentRequestSchema
>;
export type ListReassignmentRequestsInput = z.infer<
  typeof listReassignmentRequestsSchema
>;
export type ListTasksQueryInput = z.infer<typeof listTasksQuerySchema>;

export { parseWithSchema, resourceIdValue };
