-- CreateEnum
CREATE TYPE "FactureInterventionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SIGNED', 'INVOICED', 'CANCELLED');

-- CreateTable
CREATE TABLE "FactureEquipment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "location" TEXT,
    "installedAt" DATE,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureInterventionCounter" (
    "organizationId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureInterventionCounter_pkey" PRIMARY KEY ("organizationId","year")
);

-- CreateTable
CREATE TABLE "FactureIntervention" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "FactureInterventionStatus" NOT NULL DEFAULT 'PLANNED',
    "clientId" UUID NOT NULL,
    "equipmentId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "siteAddress" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedByUserId" UUID,
    "workSummary" TEXT,
    "recommendations" TEXT,
    "signerName" TEXT,
    "signedAt" TIMESTAMP(3),
    "signatureKey" TEXT,
    "reportHash" CHAR(64),
    "invoiceId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureInterventionTechnician" (
    "organizationId" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureInterventionTechnician_pkey" PRIMARY KEY ("interventionId","memberId")
);

-- CreateTable
CREATE TABLE "FactureTimeEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacturePartUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "reference" TEXT,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacturePartUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureInterventionPhoto" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "caption" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureInterventionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureEquipment_organizationId_clientId_isArchived_idx" ON "FactureEquipment"("organizationId", "clientId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "FactureEquipment_organizationId_id_key" ON "FactureEquipment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureEquipment_organizationId_clientId_id_key" ON "FactureEquipment"("organizationId", "clientId", "id");

-- CreateIndex
CREATE INDEX "FactureIntervention_organizationId_scheduledStart_idx" ON "FactureIntervention"("organizationId", "scheduledStart");

-- CreateIndex
CREATE INDEX "FactureIntervention_organizationId_status_idx" ON "FactureIntervention"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FactureIntervention_organizationId_clientId_idx" ON "FactureIntervention"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureIntervention_organizationId_id_key" ON "FactureIntervention"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureIntervention_organizationId_number_key" ON "FactureIntervention"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FactureIntervention_organizationId_invoiceId_key" ON "FactureIntervention"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "FactureInterventionTechnician_organizationId_memberId_idx" ON "FactureInterventionTechnician"("organizationId", "memberId");

-- CreateIndex
CREATE INDEX "FactureTimeEntry_organizationId_interventionId_idx" ON "FactureTimeEntry"("organizationId", "interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureTimeEntry_organizationId_id_key" ON "FactureTimeEntry"("organizationId", "id");

-- CreateIndex
CREATE INDEX "FacturePartUsage_organizationId_interventionId_idx" ON "FacturePartUsage"("organizationId", "interventionId");

-- CreateIndex
CREATE INDEX "FacturePartUsage_organizationId_itemId_idx" ON "FacturePartUsage"("organizationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "FacturePartUsage_organizationId_id_key" ON "FacturePartUsage"("organizationId", "id");

-- CreateIndex
CREATE INDEX "FactureInterventionPhoto_organizationId_interventionId_idx" ON "FactureInterventionPhoto"("organizationId", "interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureInterventionPhoto_organizationId_id_key" ON "FactureInterventionPhoto"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "FactureEquipment" ADD CONSTRAINT "FactureEquipment_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "FactureClient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureIntervention" ADD CONSTRAINT "FactureIntervention_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "FactureClient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureIntervention" ADD CONSTRAINT "FactureIntervention_organizationId_clientId_equipmentId_fkey" FOREIGN KEY ("organizationId", "clientId", "equipmentId") REFERENCES "FactureEquipment"("organizationId", "clientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureIntervention" ADD CONSTRAINT "FactureIntervention_organizationId_invoiceId_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "FactureDocument"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureInterventionTechnician" ADD CONSTRAINT "FactureInterventionTechnician_organizationId_interventionI_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "FactureIntervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureInterventionTechnician" ADD CONSTRAINT "FactureInterventionTechnician_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "FactureMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureTimeEntry" ADD CONSTRAINT "FactureTimeEntry_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "FactureIntervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureTimeEntry" ADD CONSTRAINT "FactureTimeEntry_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "FactureMember"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturePartUsage" ADD CONSTRAINT "FacturePartUsage_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "FactureIntervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacturePartUsage" ADD CONSTRAINT "FacturePartUsage_organizationId_itemId_fkey" FOREIGN KEY ("organizationId", "itemId") REFERENCES "FactureItem"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureInterventionPhoto" ADD CONSTRAINT "FactureInterventionPhoto_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "FactureIntervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─── Contrôles métier (en plus de la validation de l'API) ───

ALTER TABLE "FactureIntervention"
  ADD CONSTRAINT "FactureIntervention_schedule_check" CHECK (
    "scheduledEnd" > "scheduledStart"
    AND "scheduledEnd" <= "scheduledStart" + interval '31 days'
  ),
  ADD CONSTRAINT "FactureIntervention_sequence_check" CHECK ("sequence" >= 1),
  -- Travaux terminés : date et auteur de la fin, rapport rédigé.
  ADD CONSTRAINT "FactureIntervention_completed_check" CHECK (
    ("status" IN ('COMPLETED', 'SIGNED', 'INVOICED'))
      = ("completedAt" IS NOT NULL AND "completedByUserId" IS NOT NULL AND "workSummary" IS NOT NULL)
  ),
  -- Signature : nom, date, image et empreinte ensemble, et seulement sur une intervention signée.
  ADD CONSTRAINT "FactureIntervention_signature_check" CHECK (
    ("status" IN ('SIGNED', 'INVOICED'))
      = ("signerName" IS NOT NULL AND "signedAt" IS NOT NULL AND "signatureKey" IS NOT NULL
         AND "reportHash" IS NOT NULL)
    AND ("signedAt" IS NULL) = ("signerName" IS NULL)
    AND ("signedAt" IS NULL) = ("signatureKey" IS NULL)
    AND ("signedAt" IS NULL) = ("reportHash" IS NULL)
  ),
  ADD CONSTRAINT "FactureIntervention_invoice_check" CHECK (
    ("status" = 'INVOICED') = ("invoiceId" IS NOT NULL)
  ),
  ADD CONSTRAINT "FactureIntervention_cancel_check" CHECK (
    ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL)
    AND ("cancelledAt" IS NULL) = ("cancelReason" IS NULL)
  );

ALTER TABLE "FactureInterventionCounter"
  ADD CONSTRAINT "FactureInterventionCounter_value_check" CHECK ("value" >= 0);

ALTER TABLE "FactureTimeEntry"
  ADD CONSTRAINT "FactureTimeEntry_minutes_check" CHECK ("minutes" BETWEEN 1 AND 720);

ALTER TABLE "FacturePartUsage"
  ADD CONSTRAINT "FacturePartUsage_amounts_check" CHECK (
    "quantity" > 0 AND "unitPrice" >= 0 AND "vatRate" BETWEEN 0 AND 20
  );

-- ─── Intervention : transitions de statut et rapport figé ───
-- planifiée → en cours → réalisée → signée → facturée ; réalisée → en cours (réouverture avant
-- signature) ; planifiée ou en cours → annulée. Une fois les travaux terminés, le contenu de
-- l'intervention ne change plus (seuls la signature, puis le lien vers la facture, s'ajoutent) ; une
-- intervention ne se supprime jamais (purge d'une organisation entière exceptée).

CREATE FUNCTION "facture_intervention_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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

  -- Signature : posée une seule fois, à la signature ; jamais modifiée ni retirée ensuite.
  IF OLD."signedAt" IS NOT NULL
     AND (NEW."signerName", NEW."signedAt", NEW."signatureKey", NEW."reportHash")
         IS DISTINCT FROM (OLD."signerName", OLD."signedAt", OLD."signatureKey", OLD."reportHash") THEN
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

CREATE TRIGGER "FactureIntervention_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "FactureIntervention"
  FOR EACH ROW EXECUTE FUNCTION "facture_intervention_guard"();

-- ─── Travaux : techniciens, temps, pièces et photos ───
-- Modifiables seulement tant que l'intervention n'est pas terminée (techniciens : planifiée ou en
-- cours ; temps, pièces et photos : en cours). La ligne de l'intervention est lue « FOR SHARE » : une
-- saisie concurrente de la fin des travaux attend sa validation, puis voit le nouveau statut.

CREATE FUNCTION "facture_intervention_work_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_org uuid;
  row_intervention uuid;
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.facture_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    row_org := OLD."organizationId";
    row_intervention := OLD."interventionId";
  ELSE
    row_org := NEW."organizationId";
    row_intervention := NEW."interventionId";
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: une saisie ne se modifie pas (suppression seule)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT "status"::text INTO parent_status FROM "FactureIntervention"
    WHERE "organizationId" = row_org AND "id" = row_intervention FOR SHARE;
  IF parent_status IS NULL
     OR (TG_TABLE_NAME = 'FactureInterventionTechnician' AND parent_status NOT IN ('PLANNED', 'IN_PROGRESS'))
     OR (TG_TABLE_NAME <> 'FactureInterventionTechnician' AND parent_status <> 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_FROZEN: travaux figés (intervention %)', parent_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureInterventionTechnician_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "FactureInterventionTechnician"
  FOR EACH ROW EXECUTE FUNCTION "facture_intervention_work_guard"();
CREATE TRIGGER "FactureTimeEntry_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "FactureTimeEntry"
  FOR EACH ROW EXECUTE FUNCTION "facture_intervention_work_guard"();
CREATE TRIGGER "FacturePartUsage_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "FacturePartUsage"
  FOR EACH ROW EXECUTE FUNCTION "facture_intervention_work_guard"();
CREATE TRIGGER "FactureInterventionPhoto_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "FactureInterventionPhoto"
  FOR EACH ROW EXECUTE FUNCTION "facture_intervention_work_guard"();

-- Temps : saisi pour un technicien affecté à l'intervention.
CREATE FUNCTION "facture_time_entry_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "FactureInterventionTechnician"
    WHERE "interventionId" = NEW."interventionId" AND "memberId" = NEW."memberId"
      AND "organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_INVALID: temps saisi pour un technicien non affecté'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureTimeEntry_assigned"
  BEFORE INSERT ON "FactureTimeEntry"
  FOR EACH ROW EXECUTE FUNCTION "facture_time_entry_guard"();

-- Facture issue d'une intervention : son client ne change pas (même sur le brouillon).
CREATE FUNCTION "facture_document_intervention_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."clientId" IS DISTINCT FROM OLD."clientId" AND EXISTS (
    SELECT 1 FROM "FactureIntervention"
    WHERE "organizationId" = NEW."organizationId" AND "invoiceId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'FACTURE_INTERVENTION_INVALID: la facture d''une intervention garde son client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureDocument_intervention"
  BEFORE UPDATE OF "clientId" ON "FactureDocument"
  FOR EACH ROW EXECUTE FUNCTION "facture_document_intervention_guard"();
