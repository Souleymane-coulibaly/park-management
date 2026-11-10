-- CreateEnum
CREATE TYPE "FactureNotificationKind" AS ENUM ('CONFIRMATION', 'RESCHEDULED', 'REMINDER', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "FactureNotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "FactureNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "FactureClient" ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappOptInAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FactureNotificationSettings" (
    "organizationId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sendConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "reminderDayBefore" BOOLEAN NOT NULL DEFAULT true,
    "reminderHoursBefore" INTEGER DEFAULT 2,
    "emailFallback" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureNotificationSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "FactureNotification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "kind" "FactureNotificationKind" NOT NULL,
    "channel" "FactureNotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "appointmentAt" TIMESTAMP(3) NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "FactureNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactureNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactureNotification_status_nextAttemptAt_idx" ON "FactureNotification"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "FactureNotification_organizationId_interventionId_idx" ON "FactureNotification"("organizationId", "interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "FactureNotification_organizationId_id_key" ON "FactureNotification"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FactureNotification_organizationId_dedupeKey_key" ON "FactureNotification"("organizationId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "FactureNotification" ADD CONSTRAINT "FactureNotification_organizationId_interventionId_fkey" FOREIGN KEY ("organizationId", "interventionId") REFERENCES "FactureIntervention"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─── Contrôles métier (en plus de la validation de l'API) ───

ALTER TABLE "FactureNotificationSettings"
  ADD CONSTRAINT "FactureNotificationSettings_hours_check" CHECK (
    "reminderHoursBefore" IS NULL OR "reminderHoursBefore" IN (1, 2, 3, 4, 6, 12)
  );

ALTER TABLE "FactureClient"
  ADD CONSTRAINT "FactureClient_whatsappOptIn_check" CHECK (
    "whatsappOptIn" = ("whatsappOptInAt" IS NOT NULL)
  );

ALTER TABLE "FactureNotification"
  ADD CONSTRAINT "FactureNotification_attempts_check" CHECK ("attempts" BETWEEN 0 AND 10),
  ADD CONSTRAINT "FactureNotification_sent_check" CHECK (
    ("status" = 'SENT') = ("sentAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "FactureNotification_recipient_check" CHECK (length("recipient") BETWEEN 3 AND 200);

-- ─── Notification : contenu figé, statut final définitif ───
-- Seuls évoluent le statut (en attente → envoyée, échec, annulée, résultat inconnu), les tentatives et
-- l'identifiant du fournisseur. Une notification envoyée, en échec, annulée ou au résultat inconnu ne
-- change plus : jamais renvoyée. Suppression : purge d'une organisation entière seulement.

CREATE FUNCTION "facture_notification_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ocall.facture_purge', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'FACTURE_NOTIFICATION_FROZEN: une notification ne se supprime pas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'PENDING'
     OR (NEW."organizationId", NEW."interventionId", NEW."kind", NEW."channel", NEW."recipient",
         NEW."body", NEW."appointmentAt", NEW."sendAt", NEW."dedupeKey", NEW."createdAt")
        IS DISTINCT FROM
        (OLD."organizationId", OLD."interventionId", OLD."kind", OLD."channel", OLD."recipient",
         OLD."body", OLD."appointmentAt", OLD."sendAt", OLD."dedupeKey", OLD."createdAt")
     OR NEW."attempts" < OLD."attempts" THEN
    RAISE EXCEPTION 'FACTURE_NOTIFICATION_FROZEN: notification figée'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FactureNotification_frozen"
  BEFORE UPDATE OR DELETE ON "FactureNotification"
  FOR EACH ROW EXECUTE FUNCTION "facture_notification_guard"();
