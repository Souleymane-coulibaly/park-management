import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/facture-database';
import { AuditService } from '../../common/audit/audit.service';
import type { FactureContext } from './facture-access';
import { FacturePrismaService } from './facture-prisma.service';
import type {
  FactureClientDto,
  FactureItemDto,
  FactureListQueryDto,
  UpdateFactureClientDto,
  UpdateFactureItemDto,
} from './facture-commercial.dto';

const CLIENT_NOT_FOUND = { code: 'FACTURE_CLIENT_NOT_FOUND', message: 'Client introuvable.' };
const ITEM_NOT_FOUND = { code: 'FACTURE_ITEM_NOT_FOUND', message: 'Article introuvable.' };
const LIST_LIMIT = 200;

/** Consentement WhatsApp (F4) : date du consentement, effacée au retrait. */
const consent = (optIn: boolean | undefined) =>
  optIn
    ? { whatsappOptIn: true, whatsappOptInAt: new Date() }
    : { whatsappOptIn: false, whatsappOptInAt: null };

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Clients et catalogue d'Ocall Facture (F1). Rien n'est supprimé : un client ou un article sort des
 * listes par archivage, et les documents gardent leur copie (libellés, prix, identité figée à l'émission).
 */
@Injectable()
export class FactureClientsService {
  constructor(
    private readonly db: FacturePrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Clients ───

  listClients(ctx: FactureContext, query: FactureListQueryDto) {
    const q = query.q?.trim();
    return this.db.factureClient.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.archived ? {} : { isArchived: false }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { contactName: { contains: q, mode: 'insensitive' } },
                { nif: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      take: LIST_LIMIT,
    });
  }

  async client(ctx: FactureContext, id: string) {
    const client = await this.db.factureClient.findUnique({
      where: { organizationId_id: { organizationId: ctx.organizationId, id } },
    });
    if (!client) throw new NotFoundException(CLIENT_NOT_FOUND);
    return client;
  }

  async createClient(ctx: FactureContext, dto: FactureClientDto) {
    const client = await this.nifUnique(() =>
      this.db.factureClient.create({
        data: { organizationId: ctx.organizationId, ...dto, ...consent(dto.whatsappOptIn) },
      }),
    );
    await this.record(ctx, 'facture.client_created', 'FactureClient', client.id);
    return client;
  }

  async updateClient(ctx: FactureContext, id: string, dto: UpdateFactureClientDto) {
    const current = await this.client(ctx, id);
    // Consentement WhatsApp : daté quand il est donné, effacé quand il est retiré, inchangé sinon.
    const optIn =
      dto.whatsappOptIn === undefined || dto.whatsappOptIn === current.whatsappOptIn
        ? {}
        : consent(dto.whatsappOptIn);
    const client = await this.nifUnique(() =>
      this.db.factureClient.update({
        where: { organizationId_id: { organizationId: ctx.organizationId, id } },
        data: { ...dto, ...optIn },
      }),
    );
    await this.record(ctx, 'facture.client_updated', 'FactureClient', id, Object.keys(dto));
    return client;
  }

  // ─── Catalogue ───

  listItems(ctx: FactureContext, query: FactureListQueryDto) {
    const q = query.q?.trim();
    return this.db.factureItem.findMany({
      where: {
        organizationId: ctx.organizationId,
        ...(query.archived ? {} : { isArchived: false }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { reference: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
      take: LIST_LIMIT,
    });
  }

  async createItem(ctx: FactureContext, dto: FactureItemDto) {
    const item = await this.referenceUnique(() =>
      this.db.factureItem.create({ data: { organizationId: ctx.organizationId, ...dto } }),
    );
    await this.record(ctx, 'facture.item_created', 'FactureItem', item.id);
    return item;
  }

  async updateItem(ctx: FactureContext, id: string, dto: UpdateFactureItemDto) {
    const where = { organizationId_id: { organizationId: ctx.organizationId, id } };
    const current = await this.db.factureItem.findUnique({
      where,
      select: { stockVariantId: true },
    });
    if (!current) throw new NotFoundException(ITEM_NOT_FOUND);
    // S5 : un article miroir d'Ocall Stock est en lecture seule (Stock est la référence), sauf l'archivage.
    if (current.stockVariantId && Object.keys(dto).some((k) => k !== 'isArchived')) {
      throw new ConflictException({
        code: 'FACTURE_ITEM_STOCK_LINKED',
        message: 'Article lié à Ocall Stock : modifiez-le dans Ocall Stock, ou déliez-le d’abord.',
      });
    }
    const item = await this.referenceUnique(() => this.db.factureItem.update({ where, data: dto }));
    await this.record(ctx, 'facture.item_updated', 'FactureItem', id, Object.keys(dto));
    return item;
  }

  private async nifUnique<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'FACTURE_CLIENT_NIF_TAKEN',
          message: 'Un client porte déjà ce NIF.',
        });
      }
      throw e;
    }
  }

  private async referenceUnique<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'FACTURE_ITEM_REFERENCE_TAKEN',
          message: 'Un article porte déjà cette référence.',
        });
      }
      throw e;
    }
  }

  private record(
    ctx: FactureContext,
    action: string,
    targetType: string,
    targetId: string,
    fields?: string[],
  ) {
    return this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action,
      targetType,
      targetId,
      ...(fields ? { metadata: { fields } } : {}),
    });
  }
}
