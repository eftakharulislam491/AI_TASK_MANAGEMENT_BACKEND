export type GitHubReviewIssue = {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  line?: number;
  suggestion?: string;
};

export type GitHubFileReview = {
  fileScore: number;
  summary: string;
  issues: GitHubReviewIssue[];
  strengths: string[];
  suggestions: string[];
  fallback?: boolean;
};

export type GitHubReviewSummary = {
  score: number;
  summary: string;
  filesReviewed: number;
  filesSkipped: number;
  issues: Array<GitHubReviewIssue & { path: string }>;
  strengths: Array<{ path: string; text: string }>;
};
