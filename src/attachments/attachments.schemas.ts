import { z } from 'zod';
import {
  optionalTrimmedString,
  parseWithSchema,
  resourceIdValue,
  trimmedString,
} from '../common/utils/validation';

export const attachmentEntityTypeSchema = z.enum([
  'TASK',
  'COMMENT',
  'PROJECT',
]);

export const createAttachmentSchema = z
  .object({
    entityType: attachmentEntityTypeSchema,
    taskId: resourceIdValue.optional(),
    commentId: resourceIdValue.optional(),
    projectId: resourceIdValue.optional(),
    fileName: trimmedString,
    fileUrl: z.url().trim(),
    fileSize: z.coerce.number().int().positive().optional(),
    mimeType: optionalTrimmedString,
  })
  .superRefine((value, ctx) => {
    const expectedIdField =
      value.entityType === 'TASK'
        ? 'taskId'
        : value.entityType === 'COMMENT'
          ? 'commentId'
          : 'projectId';
    const ids = [value.taskId, value.commentId, value.projectId].filter(
      Boolean,
    );

    if (!value[expectedIdField]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [expectedIdField],
        message: `${expectedIdField} is required for ${value.entityType} attachments.`,
      });
    }

    if (ids.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entityType'],
        message: 'Exactly one parent id must be provided.',
      });
    }
  });

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;

export { parseWithSchema, resourceIdValue };
