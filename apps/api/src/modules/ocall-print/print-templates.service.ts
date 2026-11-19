import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/print-database';
import {
  PRINT_CARD_FORMAT,
  PRINT_CARD_KINDS,
  type PrintCardData,
  type PrintCardKind,
  type PrintLayout,
  type PrintSourceApp,
  parsePrintLayout,
} from '@ocall/shared';
import type {
  PrintActor,
  PrintCardContent,
  PrintScope,
  PrintTemplateSummary,
} from '../../common/integration/print-gateway';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import { isImageRefusal, processPrintLogo } from './print-images';
import { isUuid, printInvalid, printNotFound } from './print-errors';
import { PrintPrismaService } from './print-prisma.service';
import { PrintQrSigner } from './print-qr';
import { renderCardSvgs } from './print-render';

const NAME_MAX = 80;

type TemplateRow = Prisma.PrintTemplateGetPayload<{ include: { versions: true } }>;

/** Filtre Prisma du périmètre d'une application source. */
export const scopeWhere = (actor: PrintActor, scope: PrintScope) => ({
  organizationId: actor.organizationId,
  sourceApp: scope.sourceApp,
  ...(scope.scopeIds === null ? {} : { scopeId: { in: scope.scopeIds } }),
});

/** Données fictives d'un aperçu de modèle. */
export function sampleContent(kind: PrintCardKind, issuerName: string): PrintCardContent {
  return {
    issuer: { name: issuerName, nameAr: null, contact: '+223 20 00 00 00' },
    holder:
      kind === 'STUDENT'
        ? {
            firstName: 'Aminata',
            lastName: 'Diallo',
            firstNameAr: null,
            lastNameAr: null,
            reference: '2026-000123',
            group: '6e A',
            jobTitle: null,
            birthDate: '2014-03-12',
          }
        : {
            firstName: 'Moussa',
            lastName: 'Traoré',
            firstNameAr: null,
            lastNameAr: null,
            reference: 'P-000042',
            group: 'Administration',
            jobTitle: 'Secrétaire',
            birthDate: null,
          },
    period: '2026-2027',
    validUntil: '2027-07-31',
  };
}

@Injectable()
export class PrintTemplatesService {
  constructor(
    private readonly db: PrintPrismaService,
    private readonly signer: PrintQrSigner,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private summary(t: TemplateRow): PrintTemplateSummary {
    const current = t.versions.find((v) => v.version === t.currentVersion)!;
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      scopeId: t.scopeId,
      currentVersion: t.currentVersion,
      layout: current.layout as unknown as PrintLayout,
      hasLogo: current.logoKey !== null,
      archivedAt: t.archivedAt?.toISOString() ?? null,
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private async load(actor: PrintActor, scope: PrintScope, id: string): Promise<TemplateRow> {
    if (!isUuid(id)) throw printNotFound('Modèle');
    const t = await this.db.printTemplate.findFirst({
      where: { id, ...scopeWhere(actor, scope) },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!t) throw printNotFound('Modèle');
    return t;
  }

  private name(value: string): string {
    const name = value?.trim() ?? '';
    if (name.length < 2 || name.length > NAME_MAX)
      throw printInvalid('PRINT_TEMPLATE_NAME', `Nom du modèle : de 2 à ${NAME_MAX} caractères.`);
    return name;
  }

  private layout(input: unknown, kind: PrintCardKind): PrintLayout {
    const parsed = parsePrintLayout(input, kind);
    if (!parsed.ok) throw printInvalid('PRINT_LAYOUT_INVALID', parsed.error);
    return parsed.layout;
  }

  async list(actor: PrintActor, scope: PrintScope): Promise<PrintTemplateSummary[]> {
    const rows = await this.db.printTemplate.findMany({
      where: { ...scopeWhere(actor, scope), archivedAt: null },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map((t) => this.summary(t));
  }

  async create(
    actor: PrintActor,
    target: { sourceApp: PrintSourceApp; scopeId: string | null },
    input: { name: string; kind: PrintCardKind; layout: unknown },
  ): Promise<PrintTemplateSummary> {
    if (!PRINT_CARD_KINDS.includes(input.kind))
      throw printInvalid('PRINT_KIND_INVALID', 'Type de carte invalide.');
    const name = this.name(input.name);
    const layout = this.layout(input.layout, input.kind);
    const created = await this.db.$transaction(async (tx) => {
      const t = await tx.printTemplate.create({
        data: {
          organizationId: actor.organizationId,
          sourceApp: target.sourceApp,
          scopeId: target.scopeId,
          name,
          kind: input.kind,
          createdByUserId: actor.userId,
        },
      });
      await tx.printTemplateVersion.create({
        data: {
          organizationId: actor.organizationId,
          templateId: t.id,
          version: 1,
          layout: layout as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
        },
      });
      return t.id;
    });
    return this.summary(
      await this.db.printTemplate.findUniqueOrThrow({
        where: { id: created },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      }),
    );
  }

  /**
   * Nouvelle version du modèle (mise en page ou logo) ; le nom seul se modifie sans nouvelle version.
   * Les commandes déjà envoyées gardent la version utilisée.
   */
  async update(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    input: { name?: string; layout?: unknown; logoKey?: string | null },
  ): Promise<PrintTemplateSummary> {
    const t = await this.load(actor, scope, id);
    if (t.archivedAt) throw printInvalid('PRINT_TEMPLATE_ARCHIVED', 'Ce modèle est archivé.');
    const name = input.name === undefined ? undefined : this.name(input.name);
    const layout =
      input.layout === undefined ? undefined : this.layout(input.layout, t.kind as PrintCardKind);
    const newVersion = layout !== undefined || input.logoKey !== undefined;
    await this.db.$transaction(async (tx) => {
      if (newVersion) {
        // Incrément atomique : deux modifications simultanées obtiennent deux versions distinctes.
        const bumped = await tx.printTemplate.update({
          where: { id: t.id },
          data: { currentVersion: { increment: 1 }, ...(name ? { name } : {}) },
          select: { currentVersion: true },
        });
        const base = await tx.printTemplateVersion.findFirstOrThrow({
          where: { templateId: t.id, version: bumped.currentVersion - 1 },
        });
        await tx.printTemplateVersion.create({
          data: {
            organizationId: actor.organizationId,
            templateId: t.id,
            version: bumped.currentVersion,
            layout: (layout ?? base.layout) as unknown as Prisma.InputJsonValue,
            logoKey: input.logoKey === undefined ? base.logoKey : input.logoKey,
            createdByUserId: actor.userId,
          },
        });
      } else if (name) {
        await tx.printTemplate.update({ where: { id: t.id }, data: { name } });
      }
    });
    return this.summary(await this.load(actor, scope, id));
  }

  async setLogo(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    file: Buffer | null,
  ): Promise<PrintTemplateSummary> {
    await this.load(actor, scope, id);
    if (file === null) return this.update(actor, scope, id, { logoKey: null });
    const logo = await processPrintLogo(file);
    if (isImageRefusal(logo)) throw printInvalid(logo.code, logo.message);
    const key = privateKey(actor.organizationId, null, randomUUID(), 'png');
    await this.storage.put(key, logo.body, logo.mimeType);
    try {
      return await this.update(actor, scope, id, { logoKey: key });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async archive(actor: PrintActor, scope: PrintScope, id: string): Promise<void> {
    await this.load(actor, scope, id);
    await this.db.printTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  /** Version courante d'un modèle actif du périmètre (commande, aperçu). */
  async activeVersion(actor: PrintActor, scope: PrintScope, id: string) {
    const t = await this.load(actor, scope, id);
    if (t.archivedAt) throw printInvalid('PRINT_TEMPLATE_ARCHIVED', 'Ce modèle est archivé.');
    const v = t.versions[0]!;
    return {
      templateId: t.id,
      versionId: v.id,
      version: v.version,
      name: t.name,
      kind: t.kind as PrintCardKind,
      layout: v.layout as unknown as PrintLayout,
      logoKey: v.logoKey,
    };
  }

  async logo(logoKey: string | null): Promise<Buffer | null> {
    return logoKey ? this.storage.get(logoKey) : null;
  }

  /** Données complètes d'une carte : contenu de la source, numéro et QR signé. */
  cardData(kind: PrintCardKind, content: PrintCardContent, cardNumber: string): PrintCardData {
    return {
      format: PRINT_CARD_FORMAT,
      kind,
      issuer: content.issuer,
      holder: content.holder,
      period: content.period,
      validUntil: content.validUntil,
      cardNumber,
      qr: this.signer.qr(cardNumber),
    };
  }

  async preview(
    actor: PrintActor,
    scope: PrintScope,
    id: string,
    sample: { content: PrintCardContent; photo: Buffer | null } | null,
    cardNumber = 'XXXX-XXXX-XXXX',
  ): Promise<{ front: string; back: string }> {
    const v = await this.activeVersion(actor, scope, id);
    const content = sample?.content ?? sampleContent(v.kind, 'Nom de l’établissement');
    return renderCardSvgs({
      layout: v.layout,
      data: this.cardData(v.kind, content, cardNumber),
      assets: { photo: sample?.photo ?? null, logo: await this.logo(v.logoKey) },
    });
  }
}
