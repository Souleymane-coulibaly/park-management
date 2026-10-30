-- Thème premium « Ocall Aqua Premium » des sites vitrines : nouvelle valeur de thème et couleur
-- d'accent facultative. Additive : sites existants inchangés (thème et contenu conservés).

-- AlterEnum
ALTER TYPE "SiteTheme" ADD VALUE 'AQUA_PREMIUM';

-- AlterTable
ALTER TABLE "PublicSite" ADD COLUMN "accentColor" CHAR(7);

-- Contrôle d'intégrité (ajouté à la main).
ALTER TABLE "PublicSite" ADD CONSTRAINT "PublicSite_accentColor_check" CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9A-Fa-f]{6}$');
