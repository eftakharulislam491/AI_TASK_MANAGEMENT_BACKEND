import { z } from 'zod';
import {
  optionalTrimmedString,
  optionalUrlValue,
  paginationLimitValue,
  paginationPageValue,
  parseWithSchema,
  resourceIdValue,
  trimmedString,
} from '../common/utils/validation';

export const roleSchema = z.enum([
  'SUPER_ADMIN',
  'MANAGER',
  'TEAM_LEADER',
  'MEMBER',
]);

export const userTypeSchema = z.enum(['ORGANIZATION', 'MEMBER']);

export const abilityLevelSchema = z.enum([
  'BEGINNER',
  'INTERMEDIATE',
  'ADVANCED',
  'EXPERT',
]);

export const roleChangeRequestStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELED',
]);

const booleanQueryValue = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

const metadataSchema = z.record(z.string(), z.unknown());

export const updateMyProfileSchema = z.object({
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  displayName: optionalTrimmedString,
  phone: optionalTrimmedString,
  headline: optionalTrimmedString,
  bio: optionalTrimmedString,
  dateOfBirth: z.coerce.date().optional(),
  gender: optionalTrimmedString,
  addressLine1: optionalTrimmedString,
  addressLine2: optionalTrimmedString,
  city: optionalTrimmedString,
  state: optionalTrimmedString,
  country: optionalTrimmedString,
  postalCode: optionalTrimmedString,
  timezone: optionalTrimmedString,
  currentJobTitle: optionalTrimmedString,
  yearsOfExperience: z.coerce.number().int().min(0).max(80).optional(),
  totalProjects: z.coerce.number().int().min(0).max(100000).optional(),
  resumeUrl: optionalUrlValue,
  portfolioUrl: optionalUrlValue,
  websiteUrl: optionalUrlValue,
  linkedinUrl: optionalUrlValue,
  githubUrl: optionalUrlValue,
  twitterUrl: optionalUrlValue,
  socialLinks: metadataSchema.optional(),
  otherInfo: metadataSchema.optional(),
  aiMetadata: metadataSchema.optional(),
});

export const createUserAbilitySchema = z.object({
  name: trimmedString,
  category: optionalTrimmedString,
  proficiencyLevel: abilityLevelSchema.default('INTERMEDIATE'),
  proficiencyScore: z.coerce.number().int().min(1).max(100).optional(),
  yearsOfExperience: z.coerce.number().int().min(0).max(80).optional(),
  projectsCount: z.coerce.number().int().min(0).max(100000).optional(),
  isPrimary: z.boolean().optional(),
  notes: optionalTrimmedString,
  evidenceUrl: optionalUrlValue,
  keywords: z.array(trimmedString).max(30).default([]),
  aiMetadata: metadataSchema.optional(),
});

export const updateUserAbilitySchema = createUserAbilitySchema.partial();

export const listUsersQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  search: optionalTrimmedString,
  role: roleSchema.optional(),
  type: userTypeSchema.optional(),
  organizationId: resourceIdValue.optional(),
  isActive: booleanQueryValue.optional(),
});

export const createRoleChangeRequestSchema = z
  .object({
    targetUserId: resourceIdValue,
    requestedRole: roleSchema,
    organizationId: resourceIdValue.optional(),
    reason: optionalTrimmedString,
    metadata: metadataSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.requestedRole === 'SUPER_ADMIN' && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Reason is required when requesting the SUPER_ADMIN role.',
      });
    }
  });

export const listRoleChangeRequestsQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  status: roleChangeRequestStatusSchema.optional(),
  targetUserId: resourceIdValue.optional(),
  organizationId: resourceIdValue.optional(),
  scope: z.enum(['mine', 'pending', 'target', 'all']).default('mine'),
});

export const reviewRoleChangeRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: optionalTrimmedString,
});

export const cancelRoleChangeRequestSchema = z.object({
  reason: optionalTrimmedString,
});

export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;
export type CreateUserAbilityInput = z.infer<typeof createUserAbilitySchema>;
export type UpdateUserAbilityInput = z.infer<typeof updateUserAbilitySchema>;
export type ListUsersQueryInput = z.infer<typeof listUsersQuerySchema>;
export type CreateRoleChangeRequestInput = z.infer<
  typeof createRoleChangeRequestSchema
>;
export type ListRoleChangeRequestsQueryInput = z.infer<
  typeof listRoleChangeRequestsQuerySchema
>;
export type ReviewRoleChangeRequestInput = z.infer<
  typeof reviewRoleChangeRequestSchema
>;
export type CancelRoleChangeRequestInput = z.infer<
  typeof cancelRoleChangeRequestSchema
>;

export { parseWithSchema, resourceIdValue };
