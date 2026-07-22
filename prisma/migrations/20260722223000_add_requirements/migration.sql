-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "RequirementPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('FEATURE_REQUEST', 'BUG_REPORT', 'CLIENT_REQUEST', 'REQUIREMENT_CHANGE', 'MEETING_NOTE', 'GENERAL');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REQUIREMENT_STATUS_CHANGED';

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "RequirementType" NOT NULL DEFAULT 'GENERAL',
    "status" "RequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "RequirementPriority" NOT NULL DEFAULT 'MEDIUM',
    "source" TEXT,
    "clientName" TEXT,
    "clientEmail" TEXT,
    "expectedDelivery" TIMESTAMP(3),
    "actualDelivery" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatestVersion" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementVersion" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RequirementStatus" NOT NULL,
    "priority" "RequirementPriority" NOT NULL,
    "type" "RequirementType" NOT NULL,
    "changeSummary" TEXT,
    "metadata" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementChangeLog" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskRequirement" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "relationType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementDiscussion" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementDiscussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementAttachment" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Requirement_organizationId_status_idx" ON "Requirement"("organizationId", "status");
CREATE INDEX "Requirement_organizationId_projectId_idx" ON "Requirement"("organizationId", "projectId");
CREATE INDEX "Requirement_organizationId_type_priority_idx" ON "Requirement"("organizationId", "type", "priority");
CREATE INDEX "Requirement_organizationId_createdAt_idx" ON "Requirement"("organizationId", "createdAt");
CREATE UNIQUE INDEX "RequirementVersion_requirementId_version_key" ON "RequirementVersion"("requirementId", "version");
CREATE INDEX "RequirementVersion_requirementId_version_idx" ON "RequirementVersion"("requirementId", "version");
CREATE INDEX "RequirementChangeLog_requirementId_createdAt_idx" ON "RequirementChangeLog"("requirementId", "createdAt");
CREATE UNIQUE INDEX "TaskRequirement_taskId_requirementId_key" ON "TaskRequirement"("taskId", "requirementId");
CREATE INDEX "TaskRequirement_taskId_idx" ON "TaskRequirement"("taskId");
CREATE INDEX "TaskRequirement_requirementId_idx" ON "TaskRequirement"("requirementId");
CREATE INDEX "RequirementDiscussion_requirementId_createdAt_idx" ON "RequirementDiscussion"("requirementId", "createdAt");
CREATE INDEX "RequirementDiscussion_parentId_idx" ON "RequirementDiscussion"("parentId");
CREATE INDEX "RequirementAttachment_requirementId_idx" ON "RequirementAttachment"("requirementId");
CREATE INDEX "RequirementAttachment_uploadedById_idx" ON "RequirementAttachment"("uploadedById");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementVersion" ADD CONSTRAINT "RequirementVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequirementChangeLog" ADD CONSTRAINT "RequirementChangeLog_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementChangeLog" ADD CONSTRAINT "RequirementChangeLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskRequirement" ADD CONSTRAINT "TaskRequirement_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskRequirement" ADD CONSTRAINT "TaskRequirement_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementDiscussion" ADD CONSTRAINT "RequirementDiscussion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementDiscussion" ADD CONSTRAINT "RequirementDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementDiscussion" ADD CONSTRAINT "RequirementDiscussion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RequirementDiscussion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RequirementAttachment" ADD CONSTRAINT "RequirementAttachment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementAttachment" ADD CONSTRAINT "RequirementAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
