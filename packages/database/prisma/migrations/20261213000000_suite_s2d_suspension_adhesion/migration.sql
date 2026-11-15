-- Ocall Suite Sprint 2D : désactivation d'une adhésion décidée dans l'organisation (additive, sans
-- modification des lignes existantes). Une adhésion suspendue reste fermée même si une application donne
-- encore un rôle au compte ; les adhésions du même compte dans d'autres organisations ne changent pas.
ALTER TABLE "OrganizationMembership" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedByUserId" UUID;
