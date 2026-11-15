-- Ocall Suite — Sprint 2, étape C : invitation d'un compte existant dans une autre organisation, pour
-- passer de l'une à l'autre. Migration additive : une énumération et une table nouvelles ; aucune donnée
-- existante ne change.

-- CreateEnum
CREATE TYPE "OrganizationInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- CreateTable
CREATE TABLE "OrganizationInvitation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "establishmentIds" UUID[],
    "status" "OrganizationInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationInvitation_organizationId_status_idx" ON "OrganizationInvitation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrganizationInvitation_identifier_status_idx" ON "OrganizationInvitation"("identifier", "status");

-- AddForeignKey
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Une seule invitation en attente par organisation et par compte invité.
CREATE UNIQUE INDEX "OrganizationInvitation_pending_key" ON "OrganizationInvitation"("organizationId", "identifier") WHERE "status" = 'PENDING';

ALTER TABLE "OrganizationInvitation"
  ADD CONSTRAINT "OrganizationInvitation_role_check" CHECK ("role" <> 'OWNER');
