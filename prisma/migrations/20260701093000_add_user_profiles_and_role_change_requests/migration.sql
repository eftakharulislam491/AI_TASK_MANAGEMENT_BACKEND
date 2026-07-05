-- CreateEnum
CREATE TYPE "AbilityLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT');

-- CreateEnum
CREATE TYPE "RoleChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "headline" TEXT,
    "bio" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postalCode" TEXT,
    "timezone" TEXT,
    "currentJobTitle" TEXT,
    "yearsOfExperience" INTEGER,
    "totalProjects" INTEGER,
    "resumeUrl" TEXT,
    "portfolioUrl" TEXT,
    "websiteUrl" TEXT,
    "linkedinUrl" TEXT,
    "githubUrl" TEXT,
    "twitterUrl" TEXT,
    "socialLinks" JSONB,
    "otherInfo" JSONB,
    "aiMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAbility" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "proficiencyLevel" "AbilityLevel" NOT NULL DEFAULT 'INTERMEDIATE',
    "proficiencyScore" INTEGER,
    "yearsOfExperience" INTEGER,
    "projectsCount" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "evidenceUrl" TEXT,
    "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "aiMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAbility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleChangeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "requesterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "currentRole" "Role" NOT NULL,
    "requestedRole" "Role" NOT NULL,
    "status" "RoleChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "reviewNote" TEXT,
    "metadata" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewerId" TEXT,

    CONSTRAINT "RoleChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "UserProfile_city_country_idx" ON "UserProfile"("city", "country");

-- CreateIndex
CREATE INDEX "UserProfile_currentJobTitle_idx" ON "UserProfile"("currentJobTitle");

-- CreateIndex
CREATE UNIQUE INDEX "UserAbility_userId_slug_key" ON "UserAbility"("userId", "slug");

-- CreateIndex
CREATE INDEX "UserAbility_userId_category_idx" ON "UserAbility"("userId", "category");

-- CreateIndex
CREATE INDEX "UserAbility_userId_proficiencyLevel_idx" ON "UserAbility"("userId", "proficiencyLevel");

-- CreateIndex
CREATE INDEX "RoleChangeRequest_organizationId_status_requestedRole_idx" ON "RoleChangeRequest"("organizationId", "status", "requestedRole");

-- CreateIndex
CREATE INDEX "RoleChangeRequest_requesterId_status_idx" ON "RoleChangeRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "RoleChangeRequest_targetUserId_status_idx" ON "RoleChangeRequest"("targetUserId", "status");

-- CreateIndex
CREATE INDEX "RoleChangeRequest_reviewerId_status_idx" ON "RoleChangeRequest"("reviewerId", "status");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAbility" ADD CONSTRAINT "UserAbility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleChangeRequest" ADD CONSTRAINT "RoleChangeRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
