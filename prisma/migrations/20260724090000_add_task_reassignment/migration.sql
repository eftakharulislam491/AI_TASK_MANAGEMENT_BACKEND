CREATE TYPE "TaskReassignmentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TYPE "NotificationType" ADD VALUE 'TASK_REASSIGNMENT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_REASSIGNMENT_REVIEWED';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_BLOCKED';
ALTER TYPE "NotificationType" ADD VALUE 'WORKLOAD_IMBALANCE';

CREATE TABLE "TaskReassignmentRequest" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "currentAssigneeId" TEXT NOT NULL,
    "suggestedAssigneeId" TEXT,
    "status" "TaskReassignmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "reviewNote" TEXT,
    "aiConfidence" INTEGER,
    "aiReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskReassignmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskReassignmentRequest_taskId_idx" ON "TaskReassignmentRequest"("taskId");
CREATE INDEX "TaskReassignmentRequest_status_idx" ON "TaskReassignmentRequest"("status");
CREATE INDEX "TaskReassignmentRequest_organizationId_status_createdAt_idx" ON "TaskReassignmentRequest"("organizationId", "status", "createdAt");
CREATE INDEX "TaskReassignmentRequest_requesterId_status_idx" ON "TaskReassignmentRequest"("requesterId", "status");

ALTER TABLE "TaskReassignmentRequest" ADD CONSTRAINT "TaskReassignmentRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskReassignmentRequest" ADD CONSTRAINT "TaskReassignmentRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskReassignmentRequest" ADD CONSTRAINT "TaskReassignmentRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskReassignmentRequest" ADD CONSTRAINT "TaskReassignmentRequest_currentAssigneeId_fkey" FOREIGN KEY ("currentAssigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskReassignmentRequest" ADD CONSTRAINT "TaskReassignmentRequest_suggestedAssigneeId_fkey" FOREIGN KEY ("suggestedAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskReassignmentRequest" ADD CONSTRAINT "TaskReassignmentRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
