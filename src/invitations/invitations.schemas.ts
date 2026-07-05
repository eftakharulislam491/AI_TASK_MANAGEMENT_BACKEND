import { z } from 'zod';
import {
  emailValue,
  optionalTrimmedString,
  paginationLimitValue,
  paginationPageValue,
  parseWithSchema,
  passwordValue,
  resourceIdValue,
  trimmedString,
} from '../common/utils/validation';

export const joinRequestStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELED',
]);

export const sendInvitationSchema = z.object({
  email: emailValue,
  message: optionalTrimmedString,
});

export const listInvitationsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  status: joinRequestStatusSchema.optional(),
});

export const acceptInvitationSchema = z.object({
  token: trimmedString,
  firstName: trimmedString,
  lastName: trimmedString,
  displayName: optionalTrimmedString,
  password: passwordValue,
});

export type SendInvitationInput = z.infer<typeof sendInvitationSchema>;
export type ListInvitationsQueryInput = z.infer<
  typeof listInvitationsQuerySchema
>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export { parseWithSchema, resourceIdValue };
