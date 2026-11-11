-- AlterTable
ALTER TABLE "FactureIntervention" ADD COLUMN     "reportSnapshot" JSONB;


-- ─── Audit de fin de V1 ───
-- Rapport signé : les données imprimées (client, lieu, contact, équipement, techniciens) sont figées à la
-- signature, avec elle ; l'empreinte du rapport les couvre. Jamais d'instantané sans signature ; toute
-- signature posée à partir d'ici en porte un (déclencheur). Un rapport signé avant cette migration n'en a
-- pas : il reste imprimé à partir des données actuelles (comportement antérieur), sans blocage.

ALTER TABLE "FactureIntervention"
  ADD CONSTRAINT "FactureIntervention_snapshot_check" CHECK (
    "reportSnapshot" IS NULL OR "signedAt" IS NOT NULL
  );

CREATE OR REPLACE FUNCTION "facture_intervention_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.facture_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: une intervention ne se supprime pas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PLANNED' OR NEW."invoiceId" IS NOT NULL THEN
      RAISE EXCEPTION 'FACTURE_INTERVENTION_INVALID: une intervention commence planifiée'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'PLANNED' AND NEW."status" IN ('IN_PROGRESS', 'CANCELLED'))
    OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" IN ('COMPLETED', 'CANCELLED'))
    OR (OLD."status" = 'COMPLETED' AND NEW."status" IN ('SIGNED', 'IN_PROGRESS'))
    OR (OLD."status" = 'SIGNED' AND NEW."status" = 'INVOICED')
  ) THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: transition de statut interdite'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Identité de l'intervention : jamais modifiée.
  IF (NEW."organizationId", NEW."number", NEW."year", NEW."sequence", NEW."createdByUserId",
      NEW."createdAt")
     IS DISTINCT FROM
     (OLD."organizationId", OLD."number", OLD."year", OLD."sequence", OLD."createdByUserId",
      OLD."createdAt") THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: la référence d''une intervention est figée'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Travaux terminés, signés, facturés ou annulés : planning et rapport figés (sauf réouverture d'une
  -- intervention réalisée, qui retire la fin des travaux).
  IF OLD."status" IN ('COMPLETED', 'SIGNED', 'INVOICED', 'CANCELLED')
     AND NOT (OLD."status" = 'COMPLETED' AND NEW."status" = 'IN_PROGRESS')
     AND (NEW."clientId", NEW."equipmentId", NEW."title", NEW."description", NEW."siteAddress",
          NEW."contactName", NEW."contactPhone", NEW."scheduledStart", NEW."scheduledEnd",
          NEW."startedAt", NEW."completedAt", NEW."completedByUserId", NEW."workSummary",
          NEW."recommendations", NEW."cancelledAt", NEW."cancelReason")
         IS DISTINCT FROM
         (OLD."clientId", OLD."equipmentId", OLD."title", OLD."description", OLD."siteAddress",
          OLD."contactName", OLD."contactPhone", OLD."scheduledStart", OLD."scheduledEnd",
          OLD."startedAt", OLD."completedAt", OLD."completedByUserId", OLD."workSummary",
          OLD."recommendations", OLD."cancelledAt", OLD."cancelReason") THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: une intervention réalisée est figée'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Signature posée : toujours avec l'instantané des données imprimées.
  IF OLD."signedAt" IS NULL AND NEW."signedAt" IS NOT NULL AND NEW."reportSnapshot" IS NULL THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_INVALID: une signature fige les données du rapport'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Signature : posée une seule fois, à la signature ; jamais modifiée ni retirée ensuite.
  IF OLD."signedAt" IS NOT NULL
     AND (NEW."signerName", NEW."signedAt", NEW."signatureKey", NEW."reportHash", NEW."reportSnapshot")
         IS DISTINCT FROM
         (OLD."signerName", OLD."signedAt", OLD."signatureKey", OLD."reportHash", OLD."reportSnapshot") THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: la signature est définitive'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Facture : liée une seule fois, à une facture du même client.
  IF OLD."invoiceId" IS NOT NULL AND NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId" THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: la facture d''une intervention est définitive'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."invoiceId" IS NOT NULL AND OLD."invoiceId" IS NULL THEN
    SELECT "type", "clientId" INTO invoice FROM "FactureDocument"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."invoiceId";
    IF invoice."type" IS DISTINCT FROM 'INVOICE' OR invoice."clientId" IS DISTINCT FROM NEW."clientId" THEN
      RAISE EXCEPTION 'FACTURE_INTERVENTION_INVALID: une intervention se facture au même client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
