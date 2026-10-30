import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/database';
import { evaluateOpening, parseTicketQr, type ScanRefusalReason } from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { findSellingEstablishment } from '../pos/pos-scope';
import { ParkScheduleService } from './park-schedule.service';
import type { ScanTicketDto, ScansQueryDto } from './ticketing.dto';

const SCAN_SELECT = {
  id: true,
  establishmentId: true,
  result: true,
  refusalReason: true,
  entryPoint: true,
  createdAt: true,
  scannedById: true,
  scannedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
  ticket: {
    select: {
      id: true,
      establishmentId: true,
      visitorName: true,
      status: true,
      validUntil: true,
      usedAt: true,
      ticketCategory: { select: { name: true, kind: true } },
    },
  },
} as const;

type ScanRow = Prisma.TicketScanGetPayload<{ select: typeof SCAN_SELECT }>;

interface ScannedTicket {
  id: string;
  establishmentId: string;
  status: 'VALID' | 'USED' | 'EXPIRED' | 'CANCELLED';
  validFrom: Date;
  validUntil: Date;
}

/** Motif de refus indépendant de l'horaire du parc ; null si le billet est utilisable maintenant. */
function ticketRefusal(
  ticket: ScannedTicket | null,
  establishmentId: string,
  now: Date,
): ScanRefusalReason | null {
  if (!ticket) return 'UNKNOWN';
  if (ticket.establishmentId !== establishmentId) return 'OTHER_ESTABLISHMENT';
  if (ticket.status === 'CANCELLED') return 'CANCELLED';
  if (ticket.status === 'USED') return 'ALREADY_USED';
  if (ticket.status === 'EXPIRED' || ticket.validUntil < now) return 'EXPIRED';
  if (ticket.validFrom > now) return 'NOT_YET_VALID';
  return null;
}

/** Les détails du billet ne sont montrés qu'au point de contrôle de son propre établissement. */
function toScan({ scannedBy, ticket, ...scan }: ScanRow) {
  return {
    ...scan,
    scannedBy: `${scannedBy.user.firstName} ${scannedBy.user.lastName}`,
    ticket:
      ticket && ticket.establishmentId === scan.establishmentId
        ? {
            id: ticket.id,
            visitorName: ticket.visitorName,
            categoryName: ticket.ticketCategory.name,
            kind: ticket.ticketCategory.kind,
            status: ticket.status,
            validUntil: ticket.validUntil,
            usedAt: ticket.usedAt,
          }
        : null,
  };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Contrôle d'accès. Chaque scan (accepté ou refusé) est enregistré. L'entrée est validée de façon
 * atomique dans PostgreSQL : le passage VALID → USED est une mise à jour conditionnelle sur la ligne
 * du billet (verrouillée par PostgreSQL pendant l'écriture) ; deux agents scannant le même billet en
 * même temps obtiennent donc une seule entrée acceptée. L'unicité de `acceptedForTicketId` en est la
 * garantie de dernier recours au niveau du schéma.
 */
@Injectable()
export class AccessControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ParkScheduleService,
  ) {}

  async scan(auth: TenantContext, dto: ScanTicketDto) {
    const organizationId = auth.membership.organizationId;
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      dto.establishmentId,
      'PARK',
    );
    if (dto.clientRequestId) {
      const replay = await this.findReplayedScan(auth, dto.clientRequestId);
      if (replay) return replay;
    }
    try {
      const scanId = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const token = parseTicketQr(dto.qr);
        const found = token
          ? await tx.ticket.findUnique({
              where: { token },
              select: {
                id: true,
                organizationId: true,
                establishmentId: true,
                status: true,
                validFrom: true,
                validUntil: true,
              },
            })
          : null;
        // Billet d'une autre organisation : traité comme inconnu, sans aucun détail divulgué.
        const ticket = found && found.organizationId === organizationId ? found : null;

        let refusal = ticketRefusal(ticket, establishment.id, now);
        if (!refusal) {
          const ctx = await this.schedule.openingContext(
            tx,
            establishment.id,
            establishment.timezone,
            now,
          );
          if (!evaluateOpening(ctx.weekly, ctx.exceptions, ctx.moment).open)
            refusal = 'PARK_CLOSED';
        }
        if (!refusal) {
          // Passage atomique : seule la première transaction trouve encore le billet VALID.
          const { count } = await tx.ticket.updateMany({
            where: {
              id: ticket!.id,
              status: 'VALID',
              validFrom: { lte: now },
              validUntil: { gte: now },
            },
            data: { status: 'USED', usedAt: now },
          });
          if (count === 0) {
            const fresh = await tx.ticket.findUniqueOrThrow({
              where: { id: ticket!.id },
              select: {
                id: true,
                establishmentId: true,
                status: true,
                validFrom: true,
                validUntil: true,
              },
            });
            refusal = ticketRefusal(fresh, establishment.id, now) ?? 'ALREADY_USED';
          }
        }
        // Expiration constatée : le statut est mis à jour (sans jamais écraser un autre statut).
        if (refusal === 'EXPIRED' && ticket) {
          await tx.ticket.updateMany({
            where: { id: ticket.id, status: 'VALID', validUntil: { lt: now } },
            data: { status: 'EXPIRED' },
          });
        }
        const scan = await tx.ticketScan.create({
          data: {
            organizationId,
            establishmentId: establishment.id,
            ticketId: ticket?.id ?? null,
            acceptedForTicketId: refusal ? null : ticket!.id,
            result: refusal ? 'REFUSED' : 'ACCEPTED',
            refusalReason: refusal,
            entryPoint: dto.entryPoint,
            scannedById: auth.membership.id,
            clientRequestId: dto.clientRequestId,
          },
          select: { id: true },
        });
        return scan.id;
      });
      return this.get(scanId);
    } catch (error) {
      // Scan rejoué simultanément avec la même clé : renvoie le résultat déjà enregistré.
      if (dto.clientRequestId && isUniqueViolation(error)) {
        const replay = await this.findReplayedScan(auth, dto.clientRequestId);
        if (replay) return replay;
      }
      throw error;
    }
  }

  /** Historique des scans du point de contrôle (le plus récent d'abord). */
  async list(auth: TenantContext, query: ScansQueryDto) {
    await findSellingEstablishment(this.prisma, auth, query.establishmentId, 'PARK');
    const rows = await this.prisma.ticketScan.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: query.establishmentId,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      select: SCAN_SELECT,
    });
    return rows.map(toScan);
  }

  private async get(id: string) {
    const row = await this.prisma.ticketScan.findUnique({ where: { id }, select: SCAN_SELECT });
    if (!row) throw new NotFoundException({ code: 'SCAN_NOT_FOUND', message: 'Scan introuvable.' });
    return toScan(row);
  }

  private async findReplayedScan(auth: TenantContext, clientRequestId: string) {
    const existing = await this.prisma.ticketScan.findFirst({
      where: { organizationId: auth.membership.organizationId, clientRequestId },
      select: { id: true, scannedById: true },
    });
    if (!existing) return null;
    if (existing.scannedById !== auth.membership.id) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Clé de requête déjà utilisée.',
      });
    }
    return this.get(existing.id);
  }
}
