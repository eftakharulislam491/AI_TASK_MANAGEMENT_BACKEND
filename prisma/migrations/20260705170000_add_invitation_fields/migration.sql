-- AlterTable
ALTER TABLE "JoinRequest"
ADD COLUMN "invitationToken" TEXT,
ADD COLUMN "invitationEmail" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "JoinRequest_invitationToken_key" ON "JoinRequest"("invitationToken");

-- CreateIndex
CREATE INDEX "JoinRequest_invitationEmail_status_idx" ON "JoinRequest"("invitationEmail", "status");
