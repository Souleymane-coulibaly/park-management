-- Ocall Stock V1 — socle et catalogue (S1) : réglages, membres, rôles et ajustements de permissions,
-- catégories, marques, articles, variantes, codes-barres, photos, historiques, fournisseurs, recherche.
-- Base distincte des bases Ocall Suite, School et Facture. Migration additive.

-- Recherche approximative (trigrammes) et insensible aux accents.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StockRole" AS ENUM ('ADMIN', 'STORE_MANAGER', 'WAREHOUSE_MANAGER', 'STOREKEEPER', 'CASHIER', 'SALES', 'AUDITOR');

-- CreateEnum
CREATE TYPE "StockBarcodeType" AS ENUM ('EAN13', 'EAN8', 'UPCA', 'INTERNAL');

-- CreateEnum
CREATE TYPE "StockCounterKind" AS ENUM ('SKU', 'INTERNAL_CODE');

-- CreateEnum
CREATE TYPE "StockPriceKind" AS ENUM ('SALE', 'PURCHASE');

-- CreateTable
CREATE TABLE "StockSettings" (
    "organizationId" UUID NOT NULL,
    "storeName" TEXT NOT NULL,
    "defaultVatRate" INTEGER NOT NULL DEFAULT 18,
    "internalCodePrefix" TEXT NOT NULL DEFAULT 'OC',
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "StockMember" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "role" "StockRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMemberPermission" (
    "organizationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMemberPermission_pkey" PRIMARY KEY ("memberId","permission")
);

-- CreateTable
CREATE TABLE "StockNumberCounter" (
    "organizationId" UUID NOT NULL,
    "kind" "StockCounterKind" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockNumberCounter_pkey" PRIMARY KEY ("organizationId","kind")
);

-- CreateTable
CREATE TABLE "StockCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBrand" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockProduct" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" UUID,
    "brandId" UUID,
    "unit" TEXT NOT NULL DEFAULT 'unité',
    "salePrice" INTEGER NOT NULL,
    "purchasePrice" INTEGER,
    "vatRate" INTEGER NOT NULL,
    "minStock" DECIMAL(14,3),
    "isStockable" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockVariant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sku" TEXT NOT NULL,
    "salePrice" INTEGER,
    "purchasePrice" INTEGER,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBarcode" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "type" "StockBarcodeType" NOT NULL,
    "code" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockBarcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockProductImage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPriceHistory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "kind" "StockPriceKind" NOT NULL,
    "oldPrice" INTEGER,
    "newPrice" INTEGER,
    "changedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockProductHistory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockProductHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSupplier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" CHAR(2) NOT NULL DEFAULT 'ML',
    "nif" TEXT,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMember_organizationId_isActive_idx" ON "StockMember"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "StockMember_organizationId_id_key" ON "StockMember"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockMember_organizationId_userId_key" ON "StockMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "StockMemberPermission_organizationId_memberId_idx" ON "StockMemberPermission"("organizationId", "memberId");

-- CreateIndex
CREATE INDEX "StockCategory_organizationId_parentId_idx" ON "StockCategory"("organizationId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCategory_organizationId_id_key" ON "StockCategory"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockBrand_organizationId_id_key" ON "StockBrand"("organizationId", "id");

-- CreateIndex
CREATE INDEX "StockProduct_organizationId_isArchived_name_idx" ON "StockProduct"("organizationId", "isArchived", "name");

-- CreateIndex
CREATE INDEX "StockProduct_organizationId_categoryId_idx" ON "StockProduct"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "StockProduct_organizationId_brandId_idx" ON "StockProduct"("organizationId", "brandId");

-- CreateIndex
CREATE UNIQUE INDEX "StockProduct_organizationId_id_key" ON "StockProduct"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockProduct_organizationId_sku_key" ON "StockProduct"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "StockVariant_organizationId_productId_idx" ON "StockVariant"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockVariant_organizationId_id_key" ON "StockVariant"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockVariant_organizationId_sku_key" ON "StockVariant"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "StockBarcode_organizationId_variantId_idx" ON "StockBarcode"("organizationId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBarcode_organizationId_code_key" ON "StockBarcode"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockProductImage_organizationId_productId_position_key" ON "StockProductImage"("organizationId", "productId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StockProductImage_organizationId_id_key" ON "StockProductImage"("organizationId", "id");

-- CreateIndex
CREATE INDEX "StockPriceHistory_organizationId_variantId_createdAt_idx" ON "StockPriceHistory"("organizationId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockProductHistory_organizationId_productId_createdAt_idx" ON "StockProductHistory"("organizationId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockSupplier_organizationId_isArchived_name_idx" ON "StockSupplier"("organizationId", "isArchived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StockSupplier_organizationId_id_key" ON "StockSupplier"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "StockMemberPermission" ADD CONSTRAINT "StockMemberPermission_organizationId_memberId_fkey" FOREIGN KEY ("organizationId", "memberId") REFERENCES "StockMember"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCategory" ADD CONSTRAINT "StockCategory_organizationId_parentId_fkey" FOREIGN KEY ("organizationId", "parentId") REFERENCES "StockCategory"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProduct" ADD CONSTRAINT "StockProduct_organizationId_categoryId_fkey" FOREIGN KEY ("organizationId", "categoryId") REFERENCES "StockCategory"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProduct" ADD CONSTRAINT "StockProduct_organizationId_brandId_fkey" FOREIGN KEY ("organizationId", "brandId") REFERENCES "StockBrand"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockVariant" ADD CONSTRAINT "StockVariant_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "StockProduct"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBarcode" ADD CONSTRAINT "StockBarcode_organizationId_variantId_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "StockVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProductImage" ADD CONSTRAINT "StockProductImage_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "StockProduct"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPriceHistory" ADD CONSTRAINT "StockPriceHistory_organizationId_variantId_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "StockVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockProductHistory" ADD CONSTRAINT "StockProductHistory_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "StockProduct"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Contrôles (écrits à la main) ───

ALTER TABLE "StockSettings"
  ADD CONSTRAINT "StockSettings_vat_check" CHECK ("defaultVatRate" BETWEEN 0 AND 30),
  ADD CONSTRAINT "StockSettings_prefix_check" CHECK ("internalCodePrefix" ~ '^[A-Z]{2,4}$'),
  ADD CONSTRAINT "StockSettings_storeName_check" CHECK (length(btrim("storeName")) BETWEEN 1 AND 80);

ALTER TABLE "StockMemberPermission"
  ADD CONSTRAINT "StockMemberPermission_permission_check" CHECK ("permission" ~ '^stock\.[a-z.]+$');

ALTER TABLE "StockCategory"
  ADD CONSTRAINT "StockCategory_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80),
  ADD CONSTRAINT "StockCategory_parent_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "StockBrand"
  ADD CONSTRAINT "StockBrand_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 80);

ALTER TABLE "StockProduct"
  ADD CONSTRAINT "StockProduct_prices_check" CHECK ("salePrice" >= 0 AND ("purchasePrice" IS NULL OR "purchasePrice" >= 0)),
  ADD CONSTRAINT "StockProduct_vat_check" CHECK ("vatRate" BETWEEN 0 AND 30),
  ADD CONSTRAINT "StockProduct_minStock_check" CHECK ("minStock" IS NULL OR "minStock" >= 0),
  ADD CONSTRAINT "StockProduct_sku_check" CHECK ("sku" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  ADD CONSTRAINT "StockProduct_name_check" CHECK (length(btrim("name")) BETWEEN 2 AND 160);

ALTER TABLE "StockVariant"
  ADD CONSTRAINT "StockVariant_prices_check" CHECK (("salePrice" IS NULL OR "salePrice" >= 0) AND ("purchasePrice" IS NULL OR "purchasePrice" >= 0)),
  ADD CONSTRAINT "StockVariant_sku_check" CHECK ("sku" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  -- La variante par défaut n'a pas de nom ; une déclinaison en a un.
  ADD CONSTRAINT "StockVariant_name_check" CHECK (("isDefault" AND "name" IS NULL) OR (NOT "isDefault" AND length(btrim("name")) BETWEEN 1 AND 80));

ALTER TABLE "StockProductImage"
  -- Quatre photos au plus par article (positions 0 à 3, uniques).
  ADD CONSTRAINT "StockProductImage_position_check" CHECK ("position" BETWEEN 0 AND 3),
  ADD CONSTRAINT "StockProductImage_bytes_check" CHECK ("bytes" > 0);

ALTER TABLE "StockSupplier"
  ADD CONSTRAINT "StockSupplier_name_check" CHECK (length(btrim("name")) BETWEEN 2 AND 160),
  ADD CONSTRAINT "StockSupplier_leadTime_check" CHECK ("leadTimeDays" IS NULL OR "leadTimeDays" BETWEEN 0 AND 365);

ALTER TABLE "StockNumberCounter"
  ADD CONSTRAINT "StockNumberCounter_value_check" CHECK ("value" >= 0);

-- Clé de contrôle des codes GTIN (EAN-13, EAN-8, UPC-A) : pondération 3/1 depuis la droite.
CREATE FUNCTION "stock_gtin_valid"(code TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  total INTEGER := 0;
  n INTEGER := length(code);
  i INTEGER;
BEGIN
  IF code !~ '^[0-9]+$' THEN RETURN false; END IF;
  FOR i IN 1..(n - 1) LOOP
    total := total + substr(code, n - i, 1)::INTEGER * (CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END);
  END LOOP;
  RETURN (10 - total % 10) % 10 = substr(code, n, 1)::INTEGER;
END $$;

ALTER TABLE "StockBarcode"
  ADD CONSTRAINT "StockBarcode_code_check" CHECK (
    ("type" = 'EAN13' AND "code" ~ '^[0-9]{13}$' AND "stock_gtin_valid"("code"))
    OR ("type" = 'EAN8' AND "code" ~ '^[0-9]{8}$' AND "stock_gtin_valid"("code"))
    OR ("type" = 'UPCA' AND "code" ~ '^[0-9]{12}$' AND "stock_gtin_valid"("code"))
    OR ("type" = 'INTERNAL' AND "code" ~ '^[A-Z]{2,4}[0-9]{8}$')
  );

-- ─── Unicités insensibles à la casse et variante par défaut unique ───

CREATE UNIQUE INDEX "StockCategory_name_unique" ON "StockCategory"
  ("organizationId", COALESCE("parentId", '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim("name")));
CREATE UNIQUE INDEX "StockBrand_name_unique" ON "StockBrand" ("organizationId", lower(btrim("name")));
-- Références uniques sans tenir compte de la casse (la lecture d'un scanner l'ignore aussi).
CREATE UNIQUE INDEX "StockProduct_sku_ci_unique" ON "StockProduct" ("organizationId", lower("sku"));
CREATE UNIQUE INDEX "StockVariant_sku_ci_unique" ON "StockVariant" ("organizationId", lower("sku"));
CREATE UNIQUE INDEX "StockVariant_default_unique" ON "StockVariant" ("organizationId", "productId") WHERE "isDefault";

-- ─── Arborescence : deux niveaux au plus (catégorie, sous-catégorie) ───

CREATE FUNCTION "stock_category_depth"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."parentId" IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "StockCategory" p WHERE p."id" = NEW."parentId" AND p."parentId" IS NOT NULL) THEN
      RAISE EXCEPTION 'STOCK_CATEGORY_DEPTH: deux niveaux au plus (catégorie, sous-catégorie)';
    END IF;
    IF EXISTS (SELECT 1 FROM "StockCategory" c WHERE c."parentId" = NEW."id") THEN
      RAISE EXCEPTION 'STOCK_CATEGORY_DEPTH: une catégorie qui a des sous-catégories reste au premier niveau';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "StockCategory_depth"
  BEFORE INSERT OR UPDATE OF "parentId" ON "StockCategory"
  FOR EACH ROW EXECUTE FUNCTION "stock_category_depth"();

-- ─── Historiques en ajout seul (suppression admise seulement pendant une purge d'organisation) ───

CREATE FUNCTION "stock_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ocall.stock_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'STOCK_HISTORY_APPEND_ONLY: % est un historique en ajout seul', TG_TABLE_NAME;
END $$;

CREATE TRIGGER "StockPriceHistory_append_only"
  BEFORE UPDATE OR DELETE ON "StockPriceHistory"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

CREATE TRIGGER "StockProductHistory_append_only"
  BEFORE UPDATE OR DELETE ON "StockProductHistory"
  FOR EACH ROW EXECUTE FUNCTION "stock_append_only"();

-- ─── Recherche : texte normalisé (minuscules, sans accents) et trigrammes ───

CREATE FUNCTION "stock_search_text"(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(value, '')))
$$;

CREATE INDEX "StockProduct_search_trgm" ON "StockProduct"
  USING gin ("stock_search_text"("name") gin_trgm_ops);
CREATE INDEX "StockProduct_sku_trgm" ON "StockProduct"
  USING gin (lower("sku") gin_trgm_ops);
CREATE INDEX "StockSupplier_search_trgm" ON "StockSupplier"
  USING gin ("stock_search_text"("name") gin_trgm_ops);
