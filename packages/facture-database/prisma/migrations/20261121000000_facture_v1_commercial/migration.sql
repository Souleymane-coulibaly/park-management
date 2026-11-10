-- CreateEnum
CREATE TYPE "FactureClientKind" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "FactureItemKind" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "FactureDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'ACCEPTED', 'REFUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FactureLogoPlacement" AS ENUM ('HEADER', 'FOOTER', 'STAMP');

-- AlterTable
ALTER TABLE "FactureSettings" ADD COLUMN     "accentColor" CHAR(7) NOT NULL DEFAULT '#1f6f4a',
ADD COLUMN     "defaultTerms" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "city" DROP NOT NULL;

-- CreateTable
CREATE TABLE "FactureClient" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "FactureClientKind" NOT NULL DEFAULT 'COMPANY',
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'ML',
    "nif" TEXT,
    "rccm" TEXT,
    "rib" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" "FactureItemKind" NOT NULL DEFAULT 'SERVICE',
    "reference" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unité',
    "unitPrice" INTEGER NOT NULL,
    "vatRate" INTEGER NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureDocument" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" "FactureDocumentType" NOT NULL,
    "status" "FactureDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "year" INTEGER,
    "sequence" INTEGER,
    "clientId" UUID NOT NULL,
    "sourceDocumentId" UUID,
    "subject" TEXT,
    "clientReference" TEXT,
    "notes" TEXT,
    "terms" TEXT,
    "vatExemptionReason" TEXT,
    "validityDays" INTEGER,
    "issueDate" DATE,
    "validUntil" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "totalHt" BIGINT NOT NULL DEFAULT 0,
    "totalVat" BIGINT NOT NULL DEFAULT 0,
    "totalTtc" BIGINT NOT NULL DEFAULT 0,
    "vatBreakdown" JSONB NOT NULL DEFAULT '[]',
    "sellerSnapshot" JSONB,
    "clientSnapshot" JSONB,
    "sentAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "refusedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByUserId" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureDocumentLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "itemId" UUID,
    "reference" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "vatRate" INTEGER NOT NULL,
    "totalHt" BIGINT NOT NULL,

    CONSTRAINT "FactureDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactureLogo" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "placement" "FactureLogoPlacement" NOT NULL,
    "label" TEXT,
    "position" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactureLogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureClient_organizationId_isArchived_name_idx" ON "FactureClient"("organizationId", "isArchived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FactureClient_organizationId_id_key" ON "FactureClient"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureClient_organizationId_nif_key" ON "FactureClient"("organizationId", "nif");

-- CreateIndex
CREATE INDEX "FactureItem_organizationId_isArchived_name_idx" ON "FactureItem"("organizationId", "isArchived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FactureItem_organizationId_id_key" ON "FactureItem"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureItem_organizationId_reference_key" ON "FactureItem"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "FactureDocument_organizationId_type_status_createdAt_idx" ON "FactureDocument"("organizationId", "type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FactureDocument_organizationId_clientId_idx" ON "FactureDocument"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureDocument_organizationId_id_key" ON "FactureDocument"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureDocument_organizationId_type_number_key" ON "FactureDocument"("organizationId", "type", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FactureDocument_organizationId_sourceDocumentId_type_key" ON "FactureDocument"("organizationId", "sourceDocumentId", "type");

-- CreateIndex
CREATE INDEX "FactureDocumentLine_organizationId_documentId_idx" ON "FactureDocumentLine"("organizationId", "documentId");

-- CreateIndex
CREATE INDEX "FactureDocumentLine_organizationId_itemId_idx" ON "FactureDocumentLine"("organizationId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureDocumentLine_documentId_position_key" ON "FactureDocumentLine"("documentId", "position");

-- CreateIndex
CREATE INDEX "FactureLogo_organizationId_placement_position_idx" ON "FactureLogo"("organizationId", "placement", "position");

-- CreateIndex
CREATE UNIQUE INDEX "FactureLogo_organizationId_id_key" ON "FactureLogo"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "FactureDocument" ADD CONSTRAINT "FactureDocument_organizationId_clientId_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "FactureClient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureDocument" ADD CONSTRAINT "FactureDocument_organizationId_sourceDocumentId_fkey" FOREIGN KEY ("organizationId", "sourceDocumentId") REFERENCES "FactureDocument"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureDocumentLine" ADD CONSTRAINT "FactureDocumentLine_organizationId_documentId_fkey" FOREIGN KEY ("organizationId", "documentId") REFERENCES "FactureDocument"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactureDocumentLine" ADD CONSTRAINT "FactureDocumentLine_organizationId_itemId_fkey" FOREIGN KEY ("organizationId", "itemId") REFERENCES "FactureItem"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Contrôles métier (en plus de la validation de l'API) ───

ALTER TABLE "FactureSettings"
  ADD CONSTRAINT "FactureSettings_accentColor_check" CHECK ("accentColor" ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT "FactureSettings_quoteValidityDays_check" CHECK ("quoteValidityDays" BETWEEN 1 AND 365);

ALTER TABLE "FactureItem"
  ADD CONSTRAINT "FactureItem_unitPrice_check" CHECK ("unitPrice" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "FactureItem_vatRate_check" CHECK ("vatRate" BETWEEN 0 AND 20);

ALTER TABLE "FactureDocument"
  -- Un brouillon n'a jamais de numéro ; un document émis en a toujours un.
  ADD CONSTRAINT "FactureDocument_number_check" CHECK (
    ("status" = 'DRAFT') = ("number" IS NULL)
    AND ("number" IS NULL) = ("year" IS NULL)
    AND ("number" IS NULL) = ("sequence" IS NULL)
    AND ("number" IS NULL) = ("issueDate" IS NULL)
  ),
  ADD CONSTRAINT "FactureDocument_totals_check" CHECK (
    "totalHt" >= 0 AND "totalVat" >= 0 AND "totalTtc" = "totalHt" + "totalVat"
  ),
  ADD CONSTRAINT "FactureDocument_validityDays_check" CHECK ("validityDays" IS NULL OR "validityDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "FactureDocument_sentCount_check" CHECK ("sentCount" >= 0);

ALTER TABLE "FactureDocumentLine"
  ADD CONSTRAINT "FactureDocumentLine_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 1000000),
  ADD CONSTRAINT "FactureDocumentLine_unitPrice_check" CHECK ("unitPrice" BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT "FactureDocumentLine_discountPercent_check" CHECK ("discountPercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "FactureDocumentLine_vatRate_check" CHECK ("vatRate" BETWEEN 0 AND 20),
  ADD CONSTRAINT "FactureDocumentLine_totalHt_check" CHECK ("totalHt" >= 0),
  ADD CONSTRAINT "FactureDocumentLine_position_check" CHECK ("position" >= 0);

ALTER TABLE "FactureLogo"
  ADD CONSTRAINT "FactureLogo_position_check" CHECK ("position" >= 0);

-- ─── Document émis figé ───
-- Une fois émis, un document ne revient jamais en brouillon, ne se supprime pas, et ni son contenu, ni
-- ses montants, ni son numéro ne changent : seuls son statut (envoi, acceptation, annulation) et les
-- dates associées évoluent. Un document annulé ne change plus de statut. Aucune exception pour la
-- modification ; la suppression n'est possible que par la purge d'une organisation entière.

CREATE FUNCTION "facture_document_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Seule exception : la purge d'une organisation entière (`purgeFactureOrganizations`), qui pose ce
    -- réglage local à sa transaction. L'API ne le pose jamais.
    IF OLD."status" <> 'DRAFT' AND current_setting('ocall.facture_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: un document émis ne se supprime pas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."status" = 'DRAFT'
    OR (OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED')
    OR (NEW."organizationId", NEW."type", NEW."number", NEW."year", NEW."sequence", NEW."clientId",
        NEW."sourceDocumentId", NEW."subject", NEW."clientReference", NEW."notes", NEW."terms",
        NEW."vatExemptionReason", NEW."validityDays", NEW."issueDate", NEW."validUntil", NEW."currency",
        NEW."totalHt", NEW."totalVat", NEW."totalTtc", NEW."vatBreakdown", NEW."sellerSnapshot",
        NEW."clientSnapshot", NEW."createdByUserId", NEW."issuedAt", NEW."issuedByUserId")
       IS DISTINCT FROM
       (OLD."organizationId", OLD."type", OLD."number", OLD."year", OLD."sequence", OLD."clientId",
        OLD."sourceDocumentId", OLD."subject", OLD."clientReference", OLD."notes", OLD."terms",
        OLD."vatExemptionReason", OLD."validityDays", OLD."issueDate", OLD."validUntil", OLD."currency",
        OLD."totalHt", OLD."totalVat", OLD."totalTtc", OLD."vatBreakdown", OLD."sellerSnapshot",
        OLD."clientSnapshot", OLD."createdByUserId", OLD."issuedAt", OLD."issuedByUserId")
  ) THEN
    RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: un document émis est figé'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureDocument_frozen"
  BEFORE UPDATE OR DELETE ON "FactureDocument"
  FOR EACH ROW EXECUTE FUNCTION "facture_document_guard"();

-- Lignes : modifiables seulement tant que leur document est un brouillon (document introuvable :
-- suppression en cascade d'un brouillon, autorisée ; purge d'une organisation entière : autorisée).
CREATE FUNCTION "facture_document_line_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent "FactureDocumentStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO parent FROM "FactureDocument"
      WHERE "organizationId" = OLD."organizationId" AND "id" = OLD."documentId";
    IF parent IS NOT NULL AND parent <> 'DRAFT' AND NOT (
      TG_OP = 'DELETE' AND current_setting('ocall.facture_purge', true) IS NOT DISTINCT FROM 'on'
    ) THEN
      RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: lignes d’un document émis'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO parent FROM "FactureDocument"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."documentId";
    IF parent IS NOT NULL AND parent <> 'DRAFT' THEN
      RAISE EXCEPTION 'FACTURE_DOCUMENT_FROZEN: lignes d’un document émis'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "FactureDocumentLine_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "FactureDocumentLine"
  FOR EACH ROW EXECUTE FUNCTION "facture_document_line_guard"();
