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

export const notificationTypeSchema = z.enum([
  'TASK_ASSIGNED',
  'TASK_STATUS_CHANGED',
  'TASK_COMMENT',
  'TASK_DEADLINE_APPROACHING',
  'TASK_OVERDUE',
  'PROJECT_MEMBER_ADDED',
  'PROJECT_LEAVE_REQUESTED',
  'PROJECT_LEAVE_REVIEWED',
  'TEAM_MEMBER_ADDED',
  'INVITATION_RECEIVED',
  'ROLE_CHANGED',
  'ROLE_CHANGE_REQUESTED',
  'ROLE_CHANGE_REVIEWED',
  'REQUIREMENT_STATUS_CHANGED',
  'TASK_REASSIGNMENT_REQUESTED',
  'TASK_REASSIGNMENT_REVIEWED',
  'TASK_BLOCKED',
  'WORKLOAD_IMBALANCE',
  'GITHUB_PR_REVIEW_COMPLETED',
  'GITHUB_PR_REVIEW_FAILED',
  'GITHUB_PR_DECISION',
  'MENTION',
]);

export const listNotificationsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  isRead: booleanQueryValue.optional(),
  type: notificationTypeSchema.optional(),
  search: optionalTrimmedString,
});

export const markNotificationsReadSchema = z.object({
  notificationIds: z.array(resourceIdValue).min(1),
});

export const createNotificationSchema = z.object({
  userId: resourceIdValue,
  organizationId: resourceIdValue.optional(),
  type: notificationTypeSchema,
  title: trimmedString,
  body: trimmedString,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ListNotificationsQueryInput = z.infer<
  typeof listNotificationsQuerySchema
>;
export type MarkNotificationsReadInput = z.infer<
  typeof markNotificationsReadSchema
>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

export { parseWithSchema };
