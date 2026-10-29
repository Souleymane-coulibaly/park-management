import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { type PrinterConnection, validatePrinterAddress } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { establishmentScope } from '../../common/tenant-scope';
import { findSellingEstablishment } from '../pos/pos-scope';
import type { CreateTerminalDto, TerminalsQueryDto, UpdateTerminalDto } from './hardware.dto';

export const TERMINAL_SELECT = {
  id: true,
  name: true,
  isActive: true,
  printerConnection: true,
  printerAddress: true,
  paperWidth: true,
  autoPrintReceipt: true,
  drawerEnabled: true,
  drawerPin: true,
  establishment: { select: { id: true, name: true } },
} as const;

export type TerminalRow = Prisma.PosTerminalGetPayload<{ select: typeof TERMINAL_SELECT }>;

const NOT_FOUND = { code: 'TERMINAL_NOT_FOUND', message: 'Poste de caisse introuvable.' };

/** Cible matérielle transmise à l'appareil pour une impression ou une ouverture de tiroir. */
export function printerTarget(t: Pick<TerminalRow, 'printerConnection' | 'printerAddress'>) {
  return { connection: t.printerConnection, address: t.printerAddress };
}

/**
 * Postes de caisse : un poste appartient à un établissement restaurant et porte la configuration
 * de son imprimante thermique et de son tiroir-caisse.
 */
@Injectable()
export class TerminalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: TenantContext, query: TerminalsQueryDto) {
    return this.prisma.posTerminal.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: query.establishmentId,
        establishment: establishmentScope(auth),
      },
      orderBy: [{ establishment: { name: 'asc' } }, { name: 'asc' }],
      select: TERMINAL_SELECT,
    });
  }

  /** Poste visible par le membre (organisation et établissements affectés) ; 404 sinon. */
  async find(
    db: Pick<Prisma.TransactionClient, 'posTerminal'>,
    auth: TenantContext,
    id: string,
  ): Promise<TerminalRow> {
    const terminal = await db.posTerminal.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        establishment: establishmentScope(auth),
      },
      select: TERMINAL_SELECT,
    });
    if (!terminal) throw new NotFoundException(NOT_FOUND);
    return terminal;
  }

  async create(auth: TenantContext, dto: CreateTerminalDto) {
    const organizationId = auth.membership.organizationId;
    await findSellingEstablishment(this.prisma, auth, dto.establishmentId);
    const config = this.validatedConfig(dto, {
      printerConnection: 'NONE',
      printerAddress: null,
      drawerEnabled: false,
    });
    return this.prisma.$transaction(async (tx) => {
      const terminal = await tx.posTerminal.create({
        data: {
          organizationId,
          establishmentId: dto.establishmentId,
          name: dto.name,
          paperWidth: dto.paperWidth,
          autoPrintReceipt: dto.autoPrintReceipt,
          drawerPin: dto.drawerPin,
          ...config,
        },
        select: TERMINAL_SELECT,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'terminal.created',
          targetType: 'PosTerminal',
          targetId: terminal.id,
          metadata: { name: dto.name, printerConnection: terminal.printerConnection },
        },
        tx,
      );
      return terminal;
    });
  }

  async update(auth: TenantContext, id: string, dto: UpdateTerminalDto) {
    const organizationId = auth.membership.organizationId;
    return this.prisma.$transaction(async (tx) => {
      const current = await this.find(tx, auth, id);
      const config = this.validatedConfig(dto, current);
      const terminal = await tx.posTerminal.update({
        where: { id },
        data: {
          name: dto.name,
          isActive: dto.isActive,
          paperWidth: dto.paperWidth,
          autoPrintReceipt: dto.autoPrintReceipt,
          drawerPin: dto.drawerPin,
          ...config,
        },
        select: TERMINAL_SELECT,
      });
      await this.audit.record(
        {
          organizationId,
          actorUserId: auth.user.id,
          action: 'terminal.updated',
          targetType: 'PosTerminal',
          targetId: id,
          metadata: { fields: Object.keys(dto) },
        },
        tx,
      );
      return terminal;
    });
  }

  /** Cohérence imprimante / tiroir : adresse valide pour la connexion, tiroir seulement avec une imprimante. */
  private validatedConfig(
    dto: {
      printerConnection?: PrinterConnection;
      printerAddress?: string | null;
      drawerEnabled?: boolean;
    },
    current: {
      printerConnection: PrinterConnection;
      printerAddress: string | null;
      drawerEnabled: boolean;
    },
  ) {
    const printerConnection = dto.printerConnection ?? current.printerConnection;
    const rawAddress =
      dto.printerAddress !== undefined ? dto.printerAddress : current.printerAddress;
    const printerAddress =
      printerConnection === 'NONE' || printerConnection === 'SIMULATED'
        ? null
        : rawAddress?.trim() || null;
    const addressError = validatePrinterAddress(printerConnection, printerAddress);
    if (addressError)
      throw new BadRequestException({ code: 'INVALID_PRINTER_ADDRESS', message: addressError });
    const drawerEnabled = dto.drawerEnabled ?? current.drawerEnabled;
    if (drawerEnabled && printerConnection === 'NONE') {
      throw new ConflictException({
        code: 'DRAWER_REQUIRES_PRINTER',
        message:
          'Le tiroir-caisse se commande par l’imprimante : configurez d’abord une imprimante.',
      });
    }
    return { printerConnection, printerAddress, drawerEnabled };
  }
}
