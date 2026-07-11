-- CreateEnum
CREATE TYPE "ProjectLeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_LEAVE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_LEAVE_REVIEWED';

-- CreateTable
CREATE TABLE "ProjectLeaveRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ProjectLeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectLeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectLeaveRequest_organizationId_status_createdAt_idx" ON "ProjectLeaveRequest"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectLeaveRequest_projectId_status_idx" ON "ProjectLeaveRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectLeaveRequest_requesterId_status_idx" ON "ProjectLeaveRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "ProjectLeaveRequest_reviewedById_idx" ON "ProjectLeaveRequest"("reviewedById");

-- AddForeignKey
ALTER TABLE "ProjectLeaveRequest" ADD CONSTRAINT "ProjectLeaveRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLeaveRequest" ADD CONSTRAINT "ProjectLeaveRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLeaveRequest" ADD CONSTRAINT "ProjectLeaveRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLeaveRequest" ADD CONSTRAINT "ProjectLeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
