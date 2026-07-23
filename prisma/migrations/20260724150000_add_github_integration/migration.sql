CREATE TYPE "GitHubPullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');
CREATE TYPE "GitHubAIReviewStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_ATTENTION');
CREATE TYPE "GitHubPRDecision" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED');
CREATE TYPE "GitHubTestStatus" AS ENUM ('DISABLED', 'PENDING', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED');
CREATE TYPE "GitHubReviewTrigger" AS ENUM ('WEBHOOK', 'MANUAL');

ALTER TYPE "NotificationType" ADD VALUE 'GITHUB_PR_REVIEW_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'GITHUB_PR_REVIEW_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'GITHUB_PR_DECISION';

CREATE TABLE "GitHubConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubUserId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubRepository" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "projectId" TEXT,
    "githubRepositoryId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "description" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "webhookId" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "autoReviewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoMergeOnPass" BOOLEAN NOT NULL DEFAULT false,
    "aiScoreThreshold" INTEGER NOT NULL DEFAULT 80,
    "mergeMethod" TEXT NOT NULL DEFAULT 'squash',
    "testEnabled" BOOLEAN NOT NULL DEFAULT false,
    "testCommand" TEXT,
    "maxContextCharacters" INTEGER NOT NULL DEFAULT 60000,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitHubRepository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubPullRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "githubPullRequestId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "authorId" TEXT,
    "state" "GitHubPullRequestState" NOT NULL DEFAULT 'OPEN',
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "baseRef" TEXT NOT NULL,
    "baseSha" TEXT NOT NULL,
    "headRef" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changedFiles" INTEGER NOT NULL DEFAULT 0,
    "mergeable" BOOLEAN,
    "aiReviewStatus" "GitHubAIReviewStatus" NOT NULL DEFAULT 'PENDING',
    "aiScore" INTEGER,
    "aiReviewSummary" TEXT,
    "finalDecision" "GitHubPRDecision" NOT NULL DEFAULT 'PENDING',
    "finalDecidedById" TEXT,
    "finalDecisionNote" TEXT,
    "testRunStatus" "GitHubTestStatus" NOT NULL DEFAULT 'DISABLED',
    "testOutput" TEXT,
    "lastReviewHeadSha" TEXT,
    "lastReviewError" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitHubPullRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubPullRequestFile" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "previousPath" TEXT,
    "status" TEXT NOT NULL,
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changes" INTEGER NOT NULL DEFAULT 0,
    "patch" TEXT,
    "previousContent" TEXT,
    "proposedContent" TEXT,
    "language" TEXT,
    "isBinary" BOOLEAN NOT NULL DEFAULT false,
    "isReviewable" BOOLEAN NOT NULL DEFAULT true,
    "contextCharacters" INTEGER NOT NULL DEFAULT 0,
    "aiScore" INTEGER,
    "aiReviewJson" JSONB,
    "aiSummary" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GitHubPullRequestFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubPRReviewReport" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "headSha" TEXT NOT NULL,
    "trigger" "GitHubReviewTrigger" NOT NULL,
    "triggeredById" TEXT,
    "aiScore" INTEGER NOT NULL,
    "aiReviewJson" JSONB NOT NULL,
    "reportMarkdown" TEXT NOT NULL,
    "testSummaryJson" JSONB,
    "contextStats" JSONB,
    "decision" "GitHubPRDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitHubPRReviewReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubWebhookDelivery" (
    "deliveryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "headSha" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "GitHubWebhookDelivery_pkey" PRIMARY KEY ("deliveryId")
);

CREATE UNIQUE INDEX "GitHubConnection_organizationId_userId_key" ON "GitHubConnection"("organizationId", "userId");
CREATE INDEX "GitHubConnection_organizationId_githubLogin_idx" ON "GitHubConnection"("organizationId", "githubLogin");
CREATE INDEX "GitHubConnection_githubUserId_idx" ON "GitHubConnection"("githubUserId");
CREATE UNIQUE INDEX "GitHubRepository_organizationId_githubRepositoryId_key" ON "GitHubRepository"("organizationId", "githubRepositoryId");
CREATE INDEX "GitHubRepository_organizationId_isActive_idx" ON "GitHubRepository"("organizationId", "isActive");
CREATE INDEX "GitHubRepository_connectionId_idx" ON "GitHubRepository"("connectionId");
CREATE INDEX "GitHubRepository_projectId_idx" ON "GitHubRepository"("projectId");
CREATE UNIQUE INDEX "GitHubPullRequest_repositoryId_number_key" ON "GitHubPullRequest"("repositoryId", "number");
CREATE INDEX "GitHubPullRequest_organizationId_state_updatedAt_idx" ON "GitHubPullRequest"("organizationId", "state", "updatedAt");
CREATE INDEX "GitHubPullRequest_organizationId_aiReviewStatus_idx" ON "GitHubPullRequest"("organizationId", "aiReviewStatus");
CREATE INDEX "GitHubPullRequest_repositoryId_headSha_idx" ON "GitHubPullRequest"("repositoryId", "headSha");
CREATE INDEX "GitHubPullRequest_authorId_idx" ON "GitHubPullRequest"("authorId");
CREATE UNIQUE INDEX "GitHubPullRequestFile_pullRequestId_path_key" ON "GitHubPullRequestFile"("pullRequestId", "path");
CREATE INDEX "GitHubPullRequestFile_pullRequestId_isReviewable_idx" ON "GitHubPullRequestFile"("pullRequestId", "isReviewable");
CREATE UNIQUE INDEX "GitHubPRReviewReport_pullRequestId_version_key" ON "GitHubPRReviewReport"("pullRequestId", "version");
CREATE INDEX "GitHubPRReviewReport_pullRequestId_createdAt_idx" ON "GitHubPRReviewReport"("pullRequestId", "createdAt");
CREATE INDEX "GitHubPRReviewReport_triggeredById_idx" ON "GitHubPRReviewReport"("triggeredById");
CREATE INDEX "GitHubWebhookDelivery_organizationId_receivedAt_idx" ON "GitHubWebhookDelivery"("organizationId", "receivedAt");
CREATE INDEX "GitHubWebhookDelivery_repositoryId_receivedAt_idx" ON "GitHubWebhookDelivery"("repositoryId", "receivedAt");

ALTER TABLE "GitHubConnection" ADD CONSTRAINT "GitHubConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubConnection" ADD CONSTRAINT "GitHubConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubRepository" ADD CONSTRAINT "GitHubRepository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubRepository" ADD CONSTRAINT "GitHubRepository_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GitHubConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GitHubRepository" ADD CONSTRAINT "GitHubRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitHubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequest" ADD CONSTRAINT "GitHubPullRequest_finalDecidedById_fkey" FOREIGN KEY ("finalDecidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GitHubPullRequestFile" ADD CONSTRAINT "GitHubPullRequestFile_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "GitHubPullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPRReviewReport" ADD CONSTRAINT "GitHubPRReviewReport_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "GitHubPullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubPRReviewReport" ADD CONSTRAINT "GitHubPRReviewReport_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT "GitHubWebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT "GitHubWebhookDelivery_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitHubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
