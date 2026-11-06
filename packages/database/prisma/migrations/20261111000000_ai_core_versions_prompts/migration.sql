-- Ocall AI Core (Sprint 8 School) : version du prompt utilisée par chaque appel IA. Strictement additive.
-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "promptId" TEXT,
ADD COLUMN     "promptVersion" INTEGER;

