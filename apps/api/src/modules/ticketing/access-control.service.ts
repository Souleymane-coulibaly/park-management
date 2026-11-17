import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  type AccessQr,
  addDays,
  evaluateOpening,
  localMoment,
  parseAccessQr,
  parseTicketQr,
  type PassRules,
  passRefusal,
  type ScanRefusalReason,
  zonedMidnight,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../common/auth-context';
import { findSellingEstablishment } from '../pos/pos-scope';
import { StorageService } from '../../common/storage/storage.service';
import { dbDay, lockPass, toDay } from '../ticket-issuance/pass-activation';
import { ParkScheduleService } from './park-schedule.service';
import { PassQrSigner } from './pass-qr';
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
  cardId: true,
  pass: {
    select: {
      id: true,
      organizationId: true,
      kind: true,
      holderName: true,
      photoFileId: true,
      rules: true,
      status: true,
      endDate: true,
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

/**
 * Les détails du billet ne sont montrés qu'au point de contrôle de son propre établissement ; ceux d'un
 * pass (titulaire, photo pour le contrôle visuel) seulement dans un parc où il est valable.
 */
function toScan(
  { scannedBy, ticket, pass, ...scan }: ScanRow,
  photoUrl: (file: { id: string; organizationId: string }) => string,
) {
  const rules = pass ? (pass.rules as unknown as PassRules) : null;
  return {
    ...scan,
    pass:
      pass && rules && rules.siteIds.includes(scan.establishmentId)
        ? {
            id: pass.id,
            holderName: pass.holderName,
            kind: pass.kind,
            offerName: rules.offerName,
            status: pass.status,
            validUntil: dbDay(pass.endDate),
            photoUrl: pass.photoFileId
              ? photoUrl({ id: pass.photoFileId, organizationId: pass.organizationId })
              : null,
          }
        : null,
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
    private readonly storage: StorageService,
    private readonly signer: PassQrSigner,
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
        // Sprint 8 : QR de pass (fixe ou dynamique) ou de carte — même point de contrôle, même journal.
        const access = parseAccessQr(dto.qr);
        if (access) return this.scanPass(tx, auth, establishment, dto, access, now);
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
      return this.get(auth, scanId);
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
    const establishment = await findSellingEstablishment(
      this.prisma,
      auth,
      query.establishmentId,
      'PARK',
    );
    const rows = await this.prisma.ticketScan.findMany({
      where: {
        organizationId: auth.membership.organizationId,
        establishmentId: query.establishmentId,
        ...(query.date && {
          createdAt: {
            gte: zonedMidnight(query.date, establishment.timezone),
            lt: zonedMidnight(addDays(query.date, 1), establishment.timezone),
          },
        }),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
      select: SCAN_SELECT,
    });
    return rows.map((r) => toScan(r, this.photoUrl(auth)));
  }

  private photoUrl(auth: TenantContext) {
    return (file: { id: string; organizationId: string }) =>
      this.storage.temporaryUrl(file, auth.user.id).url;
  }

  private async get(auth: TenantContext, id: string) {
    const row = await this.prisma.ticketScan.findUnique({ where: { id }, select: SCAN_SELECT });
    if (!row) throw new NotFoundException({ code: 'SCAN_NOT_FOUND', message: 'Scan introuvable.' });
    return toScan(row, this.photoUrl(auth));
  }

  /**
   * Passage d'un pass. Signature vérifiée par le serveur (une falsification ou un QR d'une autre
   * organisation est « inconnu », sans détail) ; QR dynamique : fenêtre de 30 s, une même fenêtre
   * n'entre qu'une fois. La ligne du pass est verrouillée : deux passages simultanés, même dans deux
   * parcs différents, sont traités l'un après l'autre, et les quotas (du jour, de la période, partagés
   * entre les parcs autorisés) ne peuvent pas être dépassés. Le jour est celui du parc qui scanne.
   */
  private async scanPass(
    tx: Prisma.TransactionClient,
    auth: TenantContext,
    establishment: { id: string; timezone: string },
    dto: ScanTicketDto,
    access: AccessQr,
    now: Date,
  ): Promise<string> {
    const organizationId = auth.membership.organizationId;
    let passId: string | null = null;
    let cardId: string | null = null;
    let refusal: ScanRefusalReason | null = null;

    if (access.type === 'card') {
      const card = this.signer.verifyCard(access.cardNumber, access.signature)
        ? await tx.passCard.findUnique({
            where: { cardNumber: access.cardNumber },
            select: { id: true, passId: true, organizationId: true, status: true },
          })
        : null;
      if (card && card.organizationId === organizationId) {
        passId = card.passId;
        cardId = card.id;
        if (card.status !== 'ACTIVE') refusal = 'CARD_REVOKED';
      } else {
        refusal = 'UNKNOWN';
      }
    } else {
      const found = await tx.pass.findUnique({
        where: { publicId: access.publicId },
        select: { id: true, organizationId: true, qrVersion: true },
      });
      const pass = found && found.organizationId === organizationId ? found : null;
      if (!pass) {
        refusal = 'UNKNOWN';
      } else if (access.type === 'pass_static') {
        if (this.signer.verifyStatic(access.publicId, pass.qrVersion, access.signature)) {
          passId = pass.id;
        } else {
          refusal = 'UNKNOWN';
        }
      } else {
        const check = this.signer.verifyDynamic(
          access.publicId,
          pass.qrVersion,
          access.window,
          access.signature,
          now.getTime(),
        );
        if (check === 'invalid') {
          refusal = 'UNKNOWN';
        } else {
          passId = pass.id;
          if (check === 'expired') refusal = 'QR_EXPIRED';
        }
      }
    }

    const today = localMoment(now, establishment.timezone).date;
    let windowKey: string | null = null;
    if (passId && !refusal) {
      await lockPass(tx, passId);
      const pass = await tx.pass.findUniqueOrThrow({
        where: { id: passId },
        select: {
          status: true,
          rules: true,
          periods: {
            where: { status: 'PAID' },
            select: { id: true, startDate: true, endDate: true, entriesUsed: true },
          },
        },
      });
      const entriesToday = await tx.ticketScan.count({
        where: { passId, result: 'ACCEPTED', localDate: toDay(today) },
      });
      const decision = passRefusal({
        status: pass.status,
        rules: pass.rules as unknown as PassRules,
        establishmentId: establishment.id,
        today,
        periods: pass.periods.map((p) => ({
          id: p.id,
          startDate: dbDay(p.startDate!),
          endDate: dbDay(p.endDate!),
          entriesUsed: p.entriesUsed,
        })),
        entriesToday,
      });
      refusal = decision.reason;
      if (!refusal && access.type === 'pass_dynamic') {
        windowKey = `${passId}:${access.window}`;
        const reused = await tx.ticketScan.findUnique({
          where: { passWindowKey: windowKey },
          select: { id: true },
        });
        if (reused) refusal = 'QR_REUSED';
      }
      if (!refusal) {
        const ctx = await this.schedule.openingContext(
          tx,
          establishment.id,
          establishment.timezone,
          now,
        );
        if (!evaluateOpening(ctx.weekly, ctx.exceptions, ctx.moment).open) refusal = 'PARK_CLOSED';
      }
      if (!refusal && decision.period) {
        await tx.passPeriod.update({
          where: { id: decision.period.id },
          data: { entriesUsed: { increment: 1 } },
        });
      }
    }

    const scan = await tx.ticketScan.create({
      data: {
        organizationId,
        establishmentId: establishment.id,
        passId,
        cardId,
        localDate: passId ? toDay(today) : null,
        passWindowKey: refusal ? null : windowKey,
        result: refusal ? 'REFUSED' : 'ACCEPTED',
        refusalReason: refusal,
        entryPoint: dto.entryPoint,
        scannedById: auth.membership.id,
        clientRequestId: dto.clientRequestId,
      },
      select: { id: true },
    });
    return scan.id;
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
    return this.get(auth, existing.id);
  }
}
