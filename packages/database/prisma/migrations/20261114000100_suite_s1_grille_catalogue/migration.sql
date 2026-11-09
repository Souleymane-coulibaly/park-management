-- Socle commercial Ocall Suite (Sprint S1) : grille tarifaire unifiée et catalogue.
-- Données uniquement, idempotentes. Aucun abonnement existant n'est modifié : leurs tarifs restent figés
-- (agreedMonthlyPrice / agreedSetupFee) et leur offre d'origine reste rattachée.

-- 1. Ocall School en préproduction (décision D1) : essai et activation par Ocall seulement.
UPDATE "SaasProduct" SET "status" = 'PREPRODUCTION', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'OCALL_SCHOOL' AND "status" = 'COMING_SOON';

-- 2. Anciennes offres (par métier Park) retirées pour les nouveaux clients, jamais supprimées.
UPDATE "SubscriptionPlan" SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" = true
  AND "productId" IN (SELECT "id" FROM "SaasProduct"
                      WHERE "code" IN ('OCALL_PARK', 'OCALL_RESTAURANT', 'OCALL_PARK_RESTAURANT', 'OCALL_SCHOOL'));

-- 3. Grille unifiée (décision D2) : par application, 50 000 FCFA/mois sans vitrine, 65 000 avec vitrine,
--    200 000 FCFA de mise en service et formation ; essai de 14 jours ; IA 150 requêtes/mois/organisation.
INSERT INTO "SubscriptionPlan"
  ("id", "businessType", "productId", "name", "monthlyPrice", "setupFee", "currency",
   "aiMonthlyCallQuota", "storageQuotaMb", "activationMode", "includesShowcase", "trialDays",
   "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), NULL, p."id", p."name" || ' — ' || o."label", o."price", 200000, 'XOF',
       150, 1024, 'ADMIN_APPROVAL', o."showcase", 14, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SaasProduct" p
CROSS JOIN (VALUES ('Sans vitrine', 50000, false), ('Avec vitrine', 65000, true))
  AS o("label", "price", "showcase")
WHERE p."code" IN ('OCALL_PARK', 'OCALL_SCHOOL')
ON CONFLICT ("productId", "name") DO NOTHING;

-- 4. Ocall Park est une seule application (parc, restaurant ou les deux) : les produits Restaurant et
--    Parc + Restaurant ne sont plus présentés (non supprimés : abonnements existants conservés).
UPDATE "SaasProduct" SET "listed" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('OCALL_RESTAURANT', 'OCALL_PARK_RESTAURANT') AND "listed" = true;

-- 5. Catalogue Ocall Suite : Facture et Stock « Bientôt disponible ». Les autres projets restent inchangés.
INSERT INTO "SaasProduct" ("id", "code", "slug", "name", "tagline", "description", "status", "features", "billing", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'OCALL_FACTURE', 'ocall-facture', 'Ocall Facture', 'Devis, factures, pro forma et bons de commande', 'Facturation — application à venir, non commercialisable.', 'COMING_SOON', ARRAY[]::TEXT[], '{}', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OCALL_STOCK', 'ocall-stock', 'Ocall Stock', 'Stocks, fournisseurs, achats, ventes et point de vente', 'Gestion des stocks — application à venir, non commercialisable.', 'COMING_SOON', ARRAY[]::TEXT[], '{}', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- 6. Option vitrine (décision D5) : l'offre « avec vitrine » n'est exigée que pour les contrats conclus
--    depuis le socle S1. Les organisations antérieures (site déjà publié ou abonnement existant) conservent
--    le droit de publication, sans modification rétroactive.
UPDATE "Organization" o SET "showcaseGrandfathered" = true
WHERE "showcaseGrandfathered" = false
  AND (EXISTS (SELECT 1 FROM "PublicSite" s WHERE s."organizationId" = o."id" AND s."publishedAt" IS NOT NULL)
       OR EXISTS (SELECT 1 FROM "Subscription" sub WHERE sub."organizationId" = o."id"));

-- 7. Frais de mise en service déjà facturés avant S1 : jamais refacturés.
--    a) Ligne SETUP sur une facture non annulée → INVOICED, ou PAID si la facture est soldée.
INSERT INTO "ProductSetupFee" ("id", "organizationId", "productId", "amount", "status", "invoiceId", "invoicedAt", "paidAt", "createdAt", "updatedAt")
SELECT DISTINCT ON (i."organizationId", s."productId")
       gen_random_uuid(), i."organizationId", s."productId", l."amount",
       (CASE WHEN i."status" = 'PAID' THEN 'PAID' ELSE 'INVOICED' END)::"SetupFeeStatus",
       i."id", i."createdAt", i."paidAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "InvoiceLine" l
JOIN "Invoice" i ON i."id" = l."invoiceId"
JOIN "Subscription" s ON s."id" = i."subscriptionId"
WHERE l."kind" = 'SETUP' AND i."status" <> 'CANCELLED'
ORDER BY i."organizationId", s."productId", (i."status" = 'PAID') DESC, i."createdAt"
ON CONFLICT ("organizationId", "productId") DO NOTHING;
--    b) Abonnement déjà activé avant S1 sans facture de mise en service : conditions de l'époque
--       conservées, aucun setup réclamé a posteriori (WAIVED = non dû).
INSERT INTO "ProductSetupFee" ("id", "organizationId", "productId", "amount", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."organizationId", s."productId", 0, 'WAIVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Subscription" s
WHERE s."startedAt" IS NOT NULL
ON CONFLICT ("organizationId", "productId") DO NOTHING;
