import type { GitHubReviewTrigger } from '@prisma/client';

export type GitHubReviewJob = {
  pullRequestId: string;
  organizationId: string;
  headSha: string;
  trigger: GitHubReviewTrigger;
  triggeredById?: string;
  deliveryId?: string;
};

export const GITHUB_REVIEW_QUEUE = 'github-review';
