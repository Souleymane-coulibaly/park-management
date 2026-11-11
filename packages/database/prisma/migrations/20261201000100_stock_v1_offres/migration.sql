-- Ocall Stock V1 (sprint S1) : les deux offres de la grille S1 pour Ocall Stock, « sans vitrine »
-- (50 000 FCFA/mois) et « avec vitrine » (65 000 FCFA/mois, `includesShowcase`), 200 000 FCFA de mise
-- en service, essai de 14 jours, IA 150 requêtes/mois. Données uniquement, idempotentes.
-- Le produit RESTE « à venir » (COMING_SOON) et les offres INACTIVES : rien n'est proposé aux clients
-- avant la commercialisation (décision séparée, sur GO). Aucun abonnement existant n'est modifié.
INSERT INTO "SubscriptionPlan"
  ("id", "businessType", "productId", "name", "monthlyPrice", "setupFee", "currency",
   "aiMonthlyCallQuota", "storageQuotaMb", "activationMode", "includesShowcase", "trialDays",
   "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), NULL, p."id", p."name" || ' — ' || o."label", o."price", 200000, 'XOF',
       150, 1024, 'ADMIN_APPROVAL', o."showcase", 14, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SaasProduct" p
CROSS JOIN (VALUES ('Sans vitrine', 50000, false), ('Avec vitrine', 65000, true))
  AS o("label", "price", "showcase")
WHERE p."code" = 'OCALL_STOCK'
ON CONFLICT ("productId", "name") DO NOTHING;
