import { z } from 'zod';
import {
  optionalTrimmedString,
  paginationLimitValue,
  paginationPageValue,
  resourceIdValue,
} from '../common/utils/validation';

export const githubCallbackSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

export const connectRepositorySchema = z.object({
  githubRepositoryId: z.string().trim().min(1),
  projectId: resourceIdValue.nullish(),
});

export const updateRepositorySettingsSchema = z
  .object({
    projectId: resourceIdValue.nullish(),
    autoReviewEnabled: z.boolean().optional(),
    autoMergeOnPass: z.boolean().optional(),
    aiScoreThreshold: z.coerce.number().int().min(0).max(100).optional(),
    mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional(),
    testEnabled: z.boolean().optional(),
    testCommand: z.string().trim().max(500).nullish(),
    maxContextCharacters: z.coerce
      .number()
      .int()
      .min(10000)
      .max(200000)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one repository setting is required.',
  });

export const pullRequestQuerySchema = z.object({
  page: paginationPageValue,
  limit: paginationLimitValue,
  repositoryId: resourceIdValue.optional(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']).optional(),
  aiReviewStatus: z
    .enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_ATTENTION'])
    .optional(),
  search: optionalTrimmedString,
});

export const reviewDecisionSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

export const githubWebhookSchema = z.object({
  action: z.string().optional(),
  repository: z.object({
    id: z.union([z.string(), z.number()]).transform(String),
  }),
  pull_request: z
    .object({
      id: z.union([z.string(), z.number()]).transform(String),
      number: z.number().int(),
      title: z.string(),
      body: z.string().nullable(),
      html_url: z.string(),
      state: z.enum(['open', 'closed']),
      merged: z.boolean().default(false),
      draft: z.boolean().default(false),
      additions: z.number().int().default(0),
      deletions: z.number().int().default(0),
      changed_files: z.number().int().default(0),
      mergeable: z.boolean().nullable().optional(),
      created_at: z.string(),
      closed_at: z.string().nullable().optional(),
      merged_at: z.string().nullable().optional(),
      user: z.object({ login: z.string() }).nullable(),
      base: z.object({
        ref: z.string(),
        sha: z.string(),
      }),
      head: z.object({
        ref: z.string(),
        sha: z.string(),
      }),
    })
    .optional(),
});

export type GitHubCallbackInput = z.infer<typeof githubCallbackSchema>;
export type ConnectRepositoryInput = z.infer<typeof connectRepositorySchema>;
export type UpdateRepositorySettingsInput = z.infer<
  typeof updateRepositorySettingsSchema
>;
export type PullRequestQueryInput = z.infer<typeof pullRequestQuerySchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
export type GitHubWebhookInput = z.infer<typeof githubWebhookSchema>;

export { resourceIdValue };
