import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  type PaperWidth,
  type ReceiptLine,
  encodeReceiptLines,
  hasOrganizationWideScope,
  hasPermission,
  layoutReceipt,
  layoutTickets,
  ticketQrPayload,
  layoutTestPage,
  previewLines,
  toBase64,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { lockRow, visibleSalesWhere } from '../pos/pos-scope';
import type { CreatePrintJobDto, HardwareResultDto, PrintJobsQueryDto } from './hardware.dto';
import { type TerminalRow, TerminalsService, printerTarget } from './terminals.service';

const JOB_SELECT = {
  id: true,
  kind: true,
  status: true,
  paperWidth: true,
  reason: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  completedAt: true,
  saleId: true,
  ticketId: true,
  terminalId: true,
  requestedById: true,
  terminal: { select: { name: true } },
  sale: { select: { number: true } },
  requestedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
} as const;

type JobRow = Prisma.PrintJobGetPayload<{ select: typeof JOB_SELECT }>;

const toJob = ({ requestedBy, terminal, sale, ...job }: JobRow) => ({
  ...job,
  terminalName: terminal.name,
  saleNumber: sale?.number ?? null,
  requestedByName: `${requestedBy.user.firstName} ${requestedBy.user.lastName}`,
});

const NOT_FOUND = { code: 'PRINT_JOB_NOT_FOUND', message: 'Impression introuvable.' };

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Impressions thermiques. Le serveur décide de ce qui peut être imprimé et produit le flux ESC/POS ;
 * l'appareil l'envoie à l'imprimante puis rapporte le résultat. Chaque tentative est historisée.
 *
 * Règle : une impression, réussie ou non, ne modifie JAMAIS la vente ni son paiement.
 */
@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly terminals: TerminalsService,
  ) {}

  async create(auth: TenantContext, dto: CreatePrintJobDto) {
    const replay = await this.findReplay(auth, dto.clientRequestId);
    if (replay) return replay;

    const terminal = await this.terminals.find(this.prisma, auth, dto.terminalId);
    if (!terminal.isActive || terminal.printerConnection === 'NONE') {
      throw new ConflictException({
        code: 'PRINTER_NOT_CONFIGURED',
        message: 'Aucune imprimante n’est configurée pour ce poste.',
      });
    }
    if (dto.kind === 'TEST' && !hasPermission(auth.membership.role, 'hardware.manage')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Le test d’impression est réservé à la configuration du matériel.',
      });
    }
    if (dto.kind === 'REPRINT') {
      if (!hasPermission(auth.membership.role, 'receipt.reprint')) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'La réimpression est réservée aux responsables.',
        });
      }
      if (!dto.reason) {
        throw new BadRequestException({
          code: 'REASON_REQUIRED',
          message: 'Indiquez le motif de la réimpression.',
        });
      }
    }
    if (dto.ticketId && (dto.kind !== 'REPRINT' || !dto.saleId)) {
      throw new BadRequestException({
        code: 'TICKET_REPRINT_ONLY',
        message: 'Un billet seul ne peut être que réimprimé, avec sa vente.',
      });
    }
    if (
      dto.ticketId &&
      !(await this.prisma.ticket.count({ where: { id: dto.ticketId, saleId: dto.saleId } }))
    ) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: 'Billet introuvable pour cette vente.',
      });
    }
    if (dto.kind !== 'TEST' && !dto.saleId) {
      throw new BadRequestException({
        code: 'SALE_REQUIRED',
        message: 'Indiquez la vente à imprimer.',
      });
    }

    try {
      const jobId = await this.prisma.$transaction(async (tx) => {
        if (dto.saleId) await this.assertPrintableSale(tx, auth, terminal, dto.saleId, dto.kind);
        const job = await tx.printJob.create({
          data: {
            organizationId: auth.membership.organizationId,
            establishmentId: terminal.establishment.id,
            terminalId: terminal.id,
            saleId: dto.saleId ?? null,
            ticketId: dto.ticketId ?? null,
            kind: dto.kind,
            paperWidth: terminal.paperWidth,
            reason: dto.reason ?? null,
            requestedById: auth.membership.id,
            clientRequestId: dto.clientRequestId,
          },
        });
        if (dto.kind !== 'RECEIPT') {
          await this.audit.record(
            {
              organizationId: auth.membership.organizationId,
              actorUserId: auth.user.id,
              action: dto.kind === 'REPRINT' ? 'print.reprint_requested' : 'print.test_requested',
              targetType: 'PrintJob',
              targetId: job.id,
              metadata: {
                terminalId: terminal.id,
                saleId: dto.saleId ?? null,
                reason: dto.reason ?? null,
              },
            },
            tx,
          );
        }
        return job.id;
      });
      return this.withPayload(auth, jobId, terminal);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.findReplay(auth, dto.clientRequestId);
        if (again) return again;
      }
      throw error;
    }
  }

  /** L'appareil rapporte le résultat ; un résultat déjà enregistré n'est pas réécrit. */
  async reportResult(auth: TenantContext, id: string, dto: HardwareResultDto) {
    const job = await this.prisma.printJob.findFirst({
      where: {
        id,
        organizationId: auth.membership.organizationId,
        requestedById: auth.membership.id,
      },
      select: { status: true },
    });
    if (!job) throw new NotFoundException(NOT_FOUND);
    if (job.status !== 'PENDING') {
      if (job.status === dto.status) return this.get(auth, id);
      throw new ConflictException({
        code: 'PRINT_JOB_COMPLETED',
        message: 'Le résultat de cette impression est déjà enregistré.',
      });
    }
    if (dto.status === 'FAILED' && !dto.errorCode) {
      throw new BadRequestException({
        code: 'ERROR_CODE_REQUIRED',
        message: 'Code d’erreur obligatoire pour un échec.',
      });
    }
    await this.prisma.printJob.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: dto.status,
        errorCode: dto.status === 'FAILED' ? dto.errorCode : null,
        errorMessage: dto.status === 'FAILED' ? (dto.errorMessage ?? null) : null,
        completedAt: new Date(),
      },
    });
    return this.get(auth, id);
  }

  async list(auth: TenantContext, query: PrintJobsQueryDto) {
    const jobs = await this.prisma.printJob.findMany({
      where: {
        ...this.visibleWhere(auth),
        terminalId: query.terminalId,
        saleId: query.saleId,
        status: query.status,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: JOB_SELECT,
    });
    return jobs.map(toJob);
  }

  private async get(auth: TenantContext, id: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { ...this.visibleWhere(auth), id },
      select: JOB_SELECT,
    });
    if (!job) throw new NotFoundException(NOT_FOUND);
    return toJob(job);
  }

  /** Historique visible : ses propres impressions, ou celles du périmètre pour un responsable. */
  private visibleWhere(auth: TenantContext): Prisma.PrintJobWhereInput {
    const where: Prisma.PrintJobWhereInput = { organizationId: auth.membership.organizationId };
    if (!hasPermission(auth.membership.role, 'receipt.reprint'))
      where.requestedById = auth.membership.id;
    if (!hasOrganizationWideScope(auth.membership.role)) {
      where.establishment = { assignments: { some: { membershipId: auth.membership.id } } };
    }
    return where;
  }

  /**
   * Un ticket ne s'imprime qu'après confirmation du paiement, dans l'établissement du poste.
   * Le ticket « original » n'est imprimé avec succès qu'une fois : ensuite, seule une réimpression
   * (duplicata, autorisée et motivée) est possible. Un échec peut être retenté.
   */
  private async assertPrintableSale(
    tx: Prisma.TransactionClient,
    auth: TenantContext,
    terminal: TerminalRow,
    saleId: string,
    kind: 'RECEIPT' | 'REPRINT' | 'TEST',
  ) {
    const sale = await tx.sale.findFirst({
      where: { ...visibleSalesWhere(auth), id: saleId },
      select: { id: true },
    });
    if (!sale)
      throw new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Vente introuvable.' });
    await lockRow(tx, 'Sale', saleId);
    const current = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { status: true, paymentStatus: true, establishmentId: true },
    });
    if (current.establishmentId !== terminal.establishment.id) {
      throw new BadRequestException({
        code: 'TERMINAL_ESTABLISHMENT_MISMATCH',
        message: 'Ce poste n’appartient pas à l’établissement de la vente.',
      });
    }
    if (current.status !== 'OPEN' || current.paymentStatus !== 'PAID') {
      throw new ConflictException({
        code: 'SALE_NOT_PAID',
        message: 'Le ticket s’imprime après confirmation du paiement.',
      });
    }
    if (kind === 'RECEIPT') {
      const printed = await tx.printJob.count({
        where: { saleId, status: 'SUCCEEDED', kind: { in: ['RECEIPT', 'REPRINT'] } },
      });
      if (printed > 0) {
        throw new ConflictException({
          code: 'RECEIPT_ALREADY_PRINTED',
          message: 'Le ticket a déjà été imprimé : utilisez la réimpression.',
        });
      }
      const pending = await tx.printJob.count({
        where: { saleId, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 30_000) } },
      });
      if (pending > 0) {
        throw new ConflictException({
          code: 'PRINT_IN_PROGRESS',
          message: 'Une impression de ce ticket est déjà en cours.',
        });
      }
    }
  }

  private async findReplay(auth: TenantContext, clientRequestId: string) {
    const existing = await this.prisma.printJob.findFirst({
      where: { organizationId: auth.membership.organizationId, clientRequestId },
      select: { id: true, requestedById: true, terminalId: true },
    });
    if (!existing) return null;
    if (existing.requestedById !== auth.membership.id) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Clé de requête déjà utilisée.',
      });
    }
    const terminal = await this.terminals.find(this.prisma, auth, existing.terminalId);
    return this.withPayload(auth, existing.id, terminal);
  }

  /**
   * Flux à imprimer. Il n'est renvoyé que tant que l'impression est en attente : une requête rejouée
   * après une impression réussie ne déclenche pas de second ticket.
   */
  private async withPayload(auth: TenantContext, jobId: string, terminal: TerminalRow) {
    const job = await this.get(auth, jobId);
    const paperWidth = (job.paperWidth === 58 ? 58 : 80) as PaperWidth;
    const lines = job.saleId
      ? await this.saleReceipt(job.saleId, paperWidth, job.kind === 'REPRINT', job.ticketId)
      : layoutTestPage(terminal.name, terminal.establishment.name, paperWidth, job.createdAt);
    const pending = job.status === 'PENDING';
    return {
      job,
      printer: printerTarget(terminal),
      paperWidth,
      data: pending ? toBase64(encodeReceiptLines(lines)) : null,
      preview: previewLines(lines, paperWidth),
      alreadyCompleted: !pending,
    };
  }

  private async saleReceipt(
    saleId: string,
    paperWidth: PaperWidth,
    duplicate: boolean,
    ticketId: string | null,
  ): Promise<ReceiptLine[]> {
    const sale = await this.prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        activity: true,
        number: true,
        total: true,
        createdAt: true,
        organization: { select: { name: true } },
        establishment: { select: { name: true, timezone: true } },
        cashier: { select: { user: { select: { firstName: true, lastName: true } } } },
        lines: {
          select: {
            productName: true,
            variantName: true,
            quantity: true,
            unitPrice: true,
            lineTotal: true,
          },
        },
        payments: {
          where: { status: 'SUCCEEDED' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { method: true, amount: true, amountTendered: true, changeGiven: true },
        },
      },
    });
    if (sale.activity === 'PARK') {
      const tickets = await this.prisma.ticket.findMany({
        where: { saleId, ...(ticketId ? { id: ticketId } : {}), status: { not: 'CANCELLED' } },
        orderBy: [{ saleLine: { id: 'asc' } }, { position: 'asc' }],
        select: {
          id: true,
          visitorName: true,
          pricePaid: true,
          validFrom: true,
          validUntil: true,
          token: true,
          ticketCategory: { select: { name: true } },
        },
      });
      return layoutTickets(
        {
          organizationName: sale.organization.name,
          establishmentName: sale.establishment.name,
          timezone: sale.establishment.timezone,
          saleNumber: sale.number,
          duplicate,
          tickets: tickets.map((t) => ({
            id: t.id,
            visitorName: t.visitorName,
            categoryName: t.ticketCategory.name,
            pricePaid: t.pricePaid,
            validFrom: t.validFrom.toISOString(),
            validUntil: t.validUntil.toISOString(),
            qr: ticketQrPayload(t.token),
          })),
        },
        paperWidth,
      );
    }
    return layoutReceipt(
      {
        organizationName: sale.organization.name,
        establishmentName: sale.establishment.name,
        saleNumber: sale.number,
        date: sale.createdAt.toISOString(),
        timezone: sale.establishment.timezone,
        cashierName: `${sale.cashier.user.firstName} ${sale.cashier.user.lastName}`,
        lines: sale.lines,
        total: sale.total,
        payment: sale.payments[0] ?? null,
        duplicate,
      },
      paperWidth,
    );
  }
}
