import { z } from 'zod';
import {
  emailValue,
  optionalTrimmedString,
  parseWithSchema,
  passwordValue,
  trimmedString,
} from '../common/utils/validation';

export const registrationTypeSchema = z.enum(['ORGANIZATION', 'MEMBER']);

export const registerSchema = z
  .object({
    type: registrationTypeSchema,
    email: emailValue,
    password: passwordValue,
    firstName: trimmedString,
    lastName: trimmedString,
    displayName: optionalTrimmedString,
    organizationName: optionalTrimmedString,
    organizationSlug: optionalTrimmedString,
  })
  .superRefine((value, ctx) => {
    if (value.type === 'ORGANIZATION') {
      if (!value.organizationName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationName'],
          message: 'Organization name is required for organization accounts.',
        });
      }

      if (!value.organizationSlug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationSlug'],
          message: 'Organization slug is required for organization accounts.',
        });
      }
    }
  });

export const loginSchema = z.object({
  type: registrationTypeSchema,
  email: emailValue,
  password: passwordValue,
});

export const refreshSchema = z.object({
  refreshToken: trimmedString,
});

export const logoutSchema = z.object({
  refreshToken: optionalTrimmedString,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;

export { parseWithSchema };
