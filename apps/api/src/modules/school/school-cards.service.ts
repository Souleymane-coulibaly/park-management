import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PRINT_BATCH_MAX,
  type PrintCardKind,
  type PrintOrderStatus,
  SCHOOL_STAFF_CATEGORY_LABELS,
  type SchoolCardCheckResult,
} from '@ocall/shared';
import {
  PRINT_GATEWAY,
  type PrintActor,
  type PrintCardContent,
  type PrintCardSummary,
  type PrintDelivery,
  type PrintGateway,
  type PrintScope,
} from '../../common/integration/print-gateway';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage-provider';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolStaffService } from './school-staff.service';
import { SchoolService } from './school.service';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Élément introuvable.' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
/** Un élève sorti, transféré ou déscolarisé n'a plus de carte valable. */
const ACTIVE_STUDENT = ['REGISTERED', 'ENROLLED'];

type SchoolRow = {
  id: string;
  name: string;
  nameAr: string | null;
  phone: string | null;
  establishmentId: string | null;
};

/**
 * Cartes scolaires et badges du personnel d'Ocall School. School vérifie les droits et le périmètre
 * (établissements de l'utilisateur), rassemble les données et la photo de chaque titulaire, puis confie
 * tout le reste au moteur commun Ocall Print (`PRINT_GATEWAY`) : modèles, rendu, numéros et QR signés,
 * commandes, suivi. Aucun code d'impression propre à School.
 */
@Injectable()
export class SchoolCardsService {
  private readonly logger = new Logger('SchoolCards');

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly staff: SchoolStaffService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() @Inject(PRINT_GATEWAY) private readonly print?: PrintGateway,
  ) {}

  private gw(): PrintGateway {
    if (!this.print?.enabled())
      throw new ServiceUnavailableException({
        code: 'PRINT_DISABLED',
        message: 'Les cartes ne sont pas disponibles pour le moment.',
      });
    return this.print;
  }

  private actor(ctx: SchoolContext): PrintActor {
    return { organizationId: ctx.organizationId, userId: ctx.userId };
  }

  private scope(ctx: SchoolContext, schoolId?: string): PrintScope {
    return { sourceApp: 'OCALL_SCHOOL', scopeIds: schoolId ? [schoolId] : ctx.schoolIds };
  }

  available() {
    return { enabled: Boolean(this.print?.enabled()) };
  }

  // ─── Données des cartes ───

  private async schoolRow(ctx: SchoolContext, schoolId: string): Promise<SchoolRow> {
    const s = await this.db.school.findFirst({
      where: { id: schoolId, organizationId: ctx.organizationId },
      select: { id: true, name: true, nameAr: true, phone: true, establishmentId: true },
    });
    if (!s) throw new NotFoundException(NOT_FOUND);
    return s;
  }

  /** Année en cours de l'établissement (active, sinon la plus récente non close). */
  private async currentYear(schoolId: string, organizationId: string) {
    const years = await this.db.schoolYear.findMany({
      where: { organizationId, schoolId, status: { not: 'CLOSED' } },
      orderBy: [{ startsOn: 'desc' }],
      select: { id: true, label: true, endsOn: true, status: true },
    });
    return years.find((y) => y.status === 'ACTIVE') ?? years[0] ?? null;
  }

  private issuer(s: SchoolRow): PrintCardContent['issuer'] {
    return { name: s.name, nameAr: s.nameAr, contact: s.phone };
  }

  /**
   * Inscription validée de l'année en cours DANS l'établissement donné (classe, année) ; null si l'élève
   * n'y est pas inscrit. Jamais l'inscription d'un autre établissement (élève transféré).
   */
  private async enrollment(organizationId: string, studentId: string, schoolId: string) {
    return this.db.schoolEnrollment.findFirst({
      where: {
        organizationId,
        studentId,
        schoolId,
        status: 'VALIDATED',
        year: { status: { not: 'CLOSED' } },
      },
      orderBy: { year: { startsOn: 'desc' } },
      select: {
        schoolYearId: true,
        class: { select: { name: true } },
        level: { select: { name: true } },
        year: { select: { label: true, endsOn: true } },
      },
    });
  }

  private async studentPhoto(student: {
    id: string;
    organizationId: string;
    cardPhotoDocumentId: string | null;
  }): Promise<Buffer | null> {
    const doc = await this.db.schoolStudentDocument.findFirst({
      where: {
        organizationId: student.organizationId,
        studentId: student.id,
        category: 'PHOTO',
        deletedAt: null,
        ...(student.cardPhotoDocumentId ? { id: student.cardPhotoDocumentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { storageKey: true },
    });
    return doc ? this.storage.get(doc.storageKey) : null;
  }

  /** Contenu et photo d'une carte, depuis la fiche (élève ou personnel) de l'établissement de la carte. */
  private async holderContent(
    ctx: SchoolContext,
    card: { holderKind: PrintCardKind; holderId: string; scopeId: string | null },
  ): Promise<{ content: PrintCardContent; photo: Buffer | null; label: string }> {
    const s = await this.schoolRow(ctx, card.scopeId!);
    if (card.holderKind === 'STUDENT') {
      const st = await this.db.schoolStudent.findFirst({
        where: { id: card.holderId, organizationId: ctx.organizationId },
      });
      if (!st) throw new NotFoundException(NOT_FOUND);
      // Élève parti dans un autre établissement : ni sa nouvelle classe ni sa nouvelle photo ne
      // remontent vers l'établissement de la carte.
      const here = st.schoolId === card.scopeId;
      const e = here ? await this.enrollment(ctx.organizationId, st.id, card.scopeId!) : null;
      return {
        label: `${st.lastName.toUpperCase()} ${st.firstName}`,
        photo: here ? await this.studentPhoto(st) : null,
        content: {
          issuer: this.issuer(s),
          holder: {
            firstName: st.firstName,
            lastName: st.lastName,
            firstNameAr: st.firstNameAr,
            lastNameAr: st.lastNameAr,
            reference: st.matricule,
            group: e?.class?.name ?? e?.level.name ?? null,
            jobTitle: null,
            birthDate: day(st.birthDate),
          },
          period: e?.year.label ?? null,
          validUntil: day(e?.year.endsOn),
        },
      };
    }
    const sf = await this.db.schoolStaff.findFirst({
      where: { id: card.holderId, organizationId: ctx.organizationId },
    });
    if (!sf) throw new NotFoundException(NOT_FOUND);
    const year = await this.currentYear(s.id, ctx.organizationId);
    return {
      label: `${sf.lastName.toUpperCase()} ${sf.firstName}`,
      photo: sf.photoKey ? await this.storage.get(sf.photoKey) : null,
      content: {
        issuer: this.issuer(s),
        holder: {
          firstName: sf.firstName,
          lastName: sf.lastName,
          firstNameAr: sf.firstNameAr,
          lastNameAr: sf.lastNameAr,
          reference: sf.staffNumber,
          group: SCHOOL_STAFF_CATEGORY_LABELS[sf.category],
          jobTitle: sf.jobTitle,
          birthDate: null,
        },
        period: year?.label ?? null,
        validUntil: day(year?.endsOn),
      },
    };
  }

  // ─── Modèles (par établissement) ───

  async templates(ctx: SchoolContext, schoolId?: string) {
    if (schoolId) await this.school.assertSchool(ctx, schoolId);
    return this.gw().listTemplates(this.actor(ctx), this.scope(ctx, schoolId));
  }

  async createTemplate(
    ctx: SchoolContext,
    dto: { schoolId: string; name: string; kind: PrintCardKind; layout: unknown },
  ) {
    await this.school.assertSchool(ctx, dto.schoolId);
    const t = await this.gw().createTemplate(
      this.actor(ctx),
      { sourceApp: 'OCALL_SCHOOL', scopeId: dto.schoolId },
      { name: dto.name, kind: dto.kind, layout: dto.layout },
    );
    await this.school.log(ctx, 'school.card_template_created', 'PrintTemplate', t.id, {
      schoolId: dto.schoolId,
    });
    return t;
  }

  async updateTemplate(ctx: SchoolContext, id: string, dto: { name?: string; layout?: unknown }) {
    const t = await this.gw().updateTemplate(this.actor(ctx), this.scope(ctx), id, dto);
    await this.school.log(ctx, 'school.card_template_updated', 'PrintTemplate', id, {
      version: t.currentVersion,
    });
    return t;
  }

  setTemplateLogo(ctx: SchoolContext, id: string, file: Buffer | null) {
    return this.gw().setTemplateLogo(this.actor(ctx), this.scope(ctx), id, file);
  }

  async archiveTemplate(ctx: SchoolContext, id: string) {
    await this.gw().archiveTemplate(this.actor(ctx), this.scope(ctx), id);
    await this.school.log(ctx, 'school.card_template_archived', 'PrintTemplate', id, {});
  }

  /** Aperçu du modèle avec le nom et le contact réels de l'établissement, titulaire fictif. */
  async previewTemplate(ctx: SchoolContext, id: string) {
    const gw = this.gw();
    const t = (await gw.listTemplates(this.actor(ctx), this.scope(ctx))).find((x) => x.id === id);
    if (!t || !t.scopeId) throw new NotFoundException(NOT_FOUND);
    const s = await this.schoolRow(ctx, t.scopeId);
    const year = await this.currentYear(s.id, ctx.organizationId);
    const sample: PrintCardContent = {
      issuer: this.issuer(s),
      holder:
        t.kind === 'STUDENT'
          ? {
              firstName: 'Aminata',
              lastName: 'Diallo',
              firstNameAr: null,
              lastNameAr: null,
              reference: '000123',
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
              group: 'Sécurité',
              jobTitle: 'Gardien',
              birthDate: null,
            },
      period: year?.label ?? null,
      validUntil: day(year?.endsOn),
    };
    return gw.previewTemplate(this.actor(ctx), this.scope(ctx), id, {
      content: sample,
      photo: null,
    });
  }

  // ─── Cartes ───

  /**
   * Cartes des élèves désignés : chacun doit être visible, inscrit (inscription validée de l'année en
   * cours) ; la carte vaut jusqu'à la fin de l'année. Un élève qui a déjà sa carte la garde.
   */
  async issueStudents(ctx: SchoolContext, studentIds: string[]) {
    const ids = [...new Set(studentIds)];
    if (ids.length === 0 || ids.length > PRINT_BATCH_MAX || !ids.every((id) => UUID.test(id)))
      throw new BadRequestException({ code: 'CARDS_INVALID', message: 'Sélection invalide.' });
    const students = await this.db.schoolStudent.findMany({
      where: {
        id: { in: ids },
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
      },
      select: { id: true, schoolId: true, status: true, lastName: true, firstName: true },
    });
    if (students.length !== ids.length) throw new NotFoundException(NOT_FOUND);
    const holders = [];
    const notEnrolled: string[] = [];
    for (const st of students) {
      const e = await this.enrollment(ctx.organizationId, st.id, st.schoolId);
      if (!e || !ACTIVE_STUDENT.includes(st.status)) {
        notEnrolled.push(st.id);
        continue;
      }
      holders.push({
        holderKind: 'STUDENT' as const,
        holderId: st.id,
        scopeId: st.schoolId,
        validUntil: day(e.year.endsOn),
      });
    }
    if (notEnrolled.length > 0)
      throw new ConflictException({
        code: 'CARD_STUDENT_NOT_ENROLLED',
        message:
          'Une carte se crée pour un élève inscrit (inscription validée de l’année en cours).',
        details: { studentIds: notEnrolled },
      });
    const cards = await this.gw().issueCards(this.actor(ctx), 'OCALL_SCHOOL', holders);
    await this.school.log(ctx, 'school.cards_issued', 'PrintCard', null, {
      kind: 'STUDENT',
      count: cards.length,
    });
    return cards;
  }

  /** Cartes d'une classe (ou de toute l'année) : élèves inscrits et validés. */
  async issueClass(ctx: SchoolContext, dto: { schoolYearId: string; classId?: string | null }) {
    const year = await this.db.schoolYear.findFirst({
      where: {
        id: dto.schoolYearId,
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
      },
      select: { id: true },
    });
    if (!year) throw new NotFoundException(NOT_FOUND);
    const enrollments = await this.db.schoolEnrollment.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolYearId: year.id,
        status: 'VALIDATED',
        ...(dto.classId ? { classId: dto.classId } : {}),
        student: { status: { in: ['REGISTERED', 'ENROLLED'] } },
      },
      select: { studentId: true },
      take: PRINT_BATCH_MAX,
    });
    if (enrollments.length === 0) return [];
    return this.issueStudents(
      ctx,
      enrollments.map((e) => e.studentId),
    );
  }

  async issueStaff(ctx: SchoolContext, staffIds: string[]) {
    const ids = [...new Set(staffIds)];
    if (ids.length === 0 || ids.length > PRINT_BATCH_MAX || !ids.every((id) => UUID.test(id)))
      throw new BadRequestException({ code: 'CARDS_INVALID', message: 'Sélection invalide.' });
    const rows = await this.db.schoolStaff.findMany({
      where: {
        id: { in: ids },
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
      },
      select: { id: true, schoolId: true, isActive: true },
    });
    if (rows.length !== ids.length) throw new NotFoundException(NOT_FOUND);
    const inactive = rows.filter((r) => !r.isActive).map((r) => r.id);
    if (inactive.length > 0)
      throw new ConflictException({
        code: 'CARD_STAFF_INACTIVE',
        message: 'Un badge se crée pour un membre du personnel actif.',
        details: { staffIds: inactive },
      });
    const holders = [];
    for (const r of rows) {
      const year = await this.currentYear(r.schoolId, ctx.organizationId);
      holders.push({
        holderKind: 'STAFF' as const,
        holderId: r.id,
        scopeId: r.schoolId,
        validUntil: day(year?.endsOn),
      });
    }
    const cards = await this.gw().issueCards(this.actor(ctx), 'OCALL_SCHOOL', holders);
    await this.school.log(ctx, 'school.cards_issued', 'PrintCard', null, {
      kind: 'STAFF',
      count: cards.length,
    });
    return cards;
  }

  /** Cartes du périmètre, avec le titulaire (nom, matricule ou numéro, photo, état). */
  async list(
    ctx: SchoolContext,
    filter: {
      schoolId?: string;
      kind?: PrintCardKind;
      status?: 'ACTIVE' | 'REVOKED';
      holderId?: string;
    },
  ) {
    if (filter.schoolId) await this.school.assertSchool(ctx, filter.schoolId);
    const cards = await this.gw().listCards(this.actor(ctx), this.scope(ctx, filter.schoolId), {
      holderKind: filter.kind,
      status: filter.status,
      ...(filter.holderId ? { holderIds: [filter.holderId] } : {}),
    });
    return this.withHolders(ctx, cards);
  }

  private async withHolders(ctx: SchoolContext, cards: PrintCardSummary[]) {
    const studentIds = cards.filter((c) => c.holderKind === 'STUDENT').map((c) => c.holderId);
    const staffIds = cards.filter((c) => c.holderKind === 'STAFF').map((c) => c.holderId);
    const [students, staff, photos] = await Promise.all([
      this.db.schoolStudent.findMany({
        where: { organizationId: ctx.organizationId, id: { in: studentIds } },
        select: {
          id: true,
          schoolId: true,
          lastName: true,
          firstName: true,
          matricule: true,
          status: true,
        },
      }),
      this.db.schoolStaff.findMany({
        where: { organizationId: ctx.organizationId, id: { in: staffIds } },
        select: {
          id: true,
          schoolId: true,
          lastName: true,
          firstName: true,
          staffNumber: true,
          isActive: true,
          photoKey: true,
          jobTitle: true,
        },
      }),
      this.db.schoolStudentDocument.groupBy({
        by: ['studentId'],
        where: {
          organizationId: ctx.organizationId,
          studentId: { in: studentIds },
          category: 'PHOTO',
          deletedAt: null,
        },
        _count: { _all: true },
      }),
    ]);
    const st = new Map(students.map((s) => [s.id, s]));
    const sf = new Map(staff.map((s) => [s.id, s]));
    const withPhoto = new Set(photos.map((p) => p.studentId));
    return cards.map((c) => {
      if (c.holderKind === 'STUDENT') {
        const s = st.get(c.holderId);
        return {
          ...c,
          holder: s
            ? {
                lastName: s.lastName,
                firstName: s.firstName,
                reference: s.matricule,
                detail: null,
                hasPhoto: withPhoto.has(s.id),
                active: ACTIVE_STUDENT.includes(s.status) && s.schoolId === c.scopeId,
              }
            : null,
        };
      }
      const s = sf.get(c.holderId);
      return {
        ...c,
        holder: s
          ? {
              lastName: s.lastName,
              firstName: s.firstName,
              reference: s.staffNumber,
              detail: s.jobTitle,
              hasPhoto: s.photoKey !== null,
              active: s.isActive && s.schoolId === c.scopeId,
            }
          : null,
      };
    });
  }

  async revoke(ctx: SchoolContext, cardId: string, reason: string) {
    const card = await this.gw().revokeCard(this.actor(ctx), this.scope(ctx), cardId, reason);
    await this.school.log(ctx, 'school.card_revoked', 'PrintCard', cardId, { reason });
    return card;
  }

  async replace(ctx: SchoolContext, cardId: string, reason: string) {
    const card = await this.gw().replaceCard(this.actor(ctx), this.scope(ctx), cardId, reason);
    await this.school.log(ctx, 'school.card_replaced', 'PrintCard', cardId, {
      newCardId: card.id,
      reason,
    });
    return card;
  }

  private async visibleCard(ctx: SchoolContext, cardId: string) {
    if (!UUID.test(cardId)) throw new NotFoundException(NOT_FOUND);
    const [card] = await this.gw().listCards(this.actor(ctx), this.scope(ctx), {
      cardIds: [cardId],
    });
    if (!card) throw new NotFoundException(NOT_FOUND);
    return card;
  }

  async preview(ctx: SchoolContext, cardId: string, templateId: string) {
    const card = await this.visibleCard(ctx, cardId);
    const { content, photo } = await this.holderContent(ctx, card);
    return this.gw().cardPreview(
      this.actor(ctx),
      this.scope(ctx, card.scopeId ?? undefined),
      cardId,
      templateId,
      content,
      photo,
    );
  }

  /** Photo d'un élève retenue pour sa carte (désignée, sinon la plus récente du dossier). */
  async studentCardPhoto(ctx: SchoolContext, studentId: string): Promise<Buffer | null> {
    const st = await this.db.schoolStudent.findFirst({
      where: {
        id: studentId,
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
      },
      select: { id: true, organizationId: true, cardPhotoDocumentId: true },
    });
    if (!st) throw new NotFoundException(NOT_FOUND);
    return this.studentPhoto(st);
  }

  /** Désigne la photo du dossier retenue pour la carte (document PHOTO de l'élève). */
  async setStudentCardPhoto(ctx: SchoolContext, studentId: string, documentId: string | null) {
    const st = await this.db.schoolStudent.findFirst({
      where: {
        id: studentId,
        organizationId: ctx.organizationId,
        ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
      },
      select: { id: true, schoolId: true },
    });
    if (!st) throw new NotFoundException(NOT_FOUND);
    if (documentId) {
      const doc = await this.db.schoolStudentDocument.findFirst({
        where: {
          id: documentId,
          organizationId: ctx.organizationId,
          studentId,
          category: 'PHOTO',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!doc)
        throw new BadRequestException({
          code: 'CARD_PHOTO_INVALID',
          message: 'Choisissez une photo du dossier de cet élève.',
        });
    }
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [st.schoolId]);
      await tx.schoolStudent.update({
        where: { id: studentId },
        data: { cardPhotoDocumentId: documentId },
      });
    });
    await this.school.log(ctx, 'school.card_photo_selected', 'SchoolStudent', studentId, {
      documentId,
    });
    return { cardPhotoDocumentId: documentId };
  }

  // ─── Commandes ───

  async submitOrder(
    ctx: SchoolContext,
    dto: {
      schoolId: string;
      templateId: string;
      cardIds: string[];
      delivery: PrintDelivery;
      idempotencyKey: string;
    },
  ) {
    await this.school.assertSchool(ctx, dto.schoolId);
    const gw = this.gw();
    const ids = [...new Set(dto.cardIds)];
    const cards = await gw.listCards(this.actor(ctx), this.scope(ctx, dto.schoolId), {
      cardIds: ids,
    });
    if (cards.length !== ids.length) throw new NotFoundException(NOT_FOUND);
    const s = await this.schoolRow(ctx, dto.schoolId);
    const items = [];
    for (const card of cards) {
      const { content, photo } = await this.holderContent(ctx, card);
      items.push({ cardId: card.id, content, photo });
    }
    const order = await gw.submitOrder(
      this.actor(ctx),
      { sourceApp: 'OCALL_SCHOOL', scopeId: dto.schoolId, establishmentId: s.establishmentId },
      {
        templateId: dto.templateId,
        idempotencyKey: dto.idempotencyKey,
        delivery: dto.delivery,
        items,
      },
    );
    await this.school.log(ctx, 'school.card_order_submitted', 'PrintOrder', order.id, {
      number: order.number,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
    });
    return order;
  }

  async orders(ctx: SchoolContext, filter: { schoolId?: string; status?: PrintOrderStatus }) {
    if (filter.schoolId) await this.school.assertSchool(ctx, filter.schoolId);
    return this.gw().listOrders(this.actor(ctx), this.scope(ctx, filter.schoolId), {
      status: filter.status,
    });
  }

  order(ctx: SchoolContext, id: string) {
    return this.gw().getOrder(this.actor(ctx), this.scope(ctx), id);
  }

  async cancelOrder(ctx: SchoolContext, id: string, reason: string) {
    const order = await this.gw().cancelOrder(this.actor(ctx), this.scope(ctx), id, reason);
    await this.school.log(ctx, 'school.card_order_cancelled', 'PrintOrder', id, { reason });
    return order;
  }

  async orderProof(ctx: SchoolContext, id: string) {
    const gw = this.gw();
    const order = await gw.getOrder(this.actor(ctx), this.scope(ctx), id);
    return {
      pdf: await gw.orderProofPdf(this.actor(ctx), this.scope(ctx), id),
      number: order.number,
    };
  }

  // ─── Lecture d'une carte ───

  /**
   * QR lu par un membre School autorisé : seules les cartes School de ses établissements sont reconnues
   * (une carte d'une autre organisation, d'un autre établissement ou falsifiée est « inconnue »). La
   * carte n'est valable que si elle est active ET que son titulaire est toujours actif dans
   * l'établissement de la carte.
   */
  async verify(ctx: SchoolContext, qr: string) {
    const card = await this.gw().verifyCard(this.actor(ctx), qr);
    if (
      !card ||
      card.sourceApp !== 'OCALL_SCHOOL' ||
      !card.scopeId ||
      (ctx.schoolIds && !ctx.schoolIds.includes(card.scopeId))
    )
      return { result: 'UNKNOWN' as SchoolCardCheckResult };
    const [withHolder] = await this.withHolders(ctx, [card]);
    const holder = withHolder!.holder;
    const result: SchoolCardCheckResult =
      card.status !== 'ACTIVE' ? 'REVOKED' : holder?.active ? 'VALID' : 'HOLDER_INACTIVE';
    return {
      result,
      card: {
        id: card.id,
        cardNumber: card.cardNumber,
        status: card.status,
        holderKind: card.holderKind,
        holderId: card.holderId,
        schoolId: card.scopeId,
        validUntil: card.validUntil,
        revokeReason: card.revokeReason,
      },
      holder,
    };
  }

  // ─── Révocation automatique (au mieux) ───

  /**
   * Départ ou transfert d'un élève : ses cartes actives sont révoquées. Une panne d'Ocall Print n'empêche
   * pas l'action School ; la lecture d'une carte contrôle de toute façon l'état du titulaire.
   */
  async onStudentLeft(ctx: SchoolContext, studentId: string, reason: string) {
    if (!this.print?.enabled()) return;
    try {
      await this.print.revokeHolderCards(
        this.actor(ctx),
        'OCALL_SCHOOL',
        'STUDENT',
        studentId,
        reason,
      );
    } catch (error) {
      this.logger.warn(`Révocation des cartes différée : ${(error as Error).name}`);
    }
  }
}
