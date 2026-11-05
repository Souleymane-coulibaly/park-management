import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  type SchoolLocale,
  type SchoolNotificationKind,
  type SchoolSmsKind,
  portalNotificationHref,
  smsText,
} from '@ocall/shared';
import { SchoolPrismaService } from './school-prisma.service';
import { today } from './school-report-cards.service';
import { SchoolSmsService, type SmsToSend } from './school-sms.service';

type Db = SchoolPrismaService | Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const PAGE = 50;
const OVERDUE_SCAN_MS = 60 * 60_000;
const OVERDUE_BATCH = 1000;

/** Périmètre d'un compte du portail : ses enfants autorisés et les annonces qui les visent aujourd'hui. */
export interface PortalScope {
  studentIds: string[];
  announcementIds: string[];
}

export interface StudentEvent {
  organizationId: string;
  schoolId: string;
  kind: SchoolNotificationKind;
  resourceId: string | null;
  studentIds: string[];
  /** Clé du fait pour un élève : une notification par compte, un SMS par responsable, jamais deux. */
  dedupe: (studentId: string) => string;
  params?: Record<string, string>;
  /** SMS aux responsables qui les acceptent, si l'établissement les a activés. */
  sms?: { kind: SchoolSmsKind; date?: string };
}

/**
 * Notifications internes du portail parents (Sprint 6) et départ des SMS correspondants. Destinataires :
 * les responsables dont le lien autorise le suivi de l'élève (portail : compte actif ; SMS : accord du
 * lien). Les doublons sont écartés par la base (clé du fait).
 */
@Injectable()
export class SchoolNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchoolNotificationsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly sms: SchoolSmsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.scanOverdue(), OVERDUE_SCAN_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Notifie les responsables des élèves concernés par un fait (absence, retard, bulletin, échéance). À
   * appeler dans la transaction du fait quand il y en a une : notification et SMS partent avec lui.
   */
  async notifyStudents(db: Db, event: StudentEvent): Promise<void> {
    if (event.studentIds.length === 0) return;
    const [school, links] = await Promise.all([
      db.school.findUniqueOrThrow({
        where: { id: event.schoolId },
        select: { name: true, nameAr: true, defaultLocale: true },
      }),
      db.schoolStudentGuardian.findMany({
        where: {
          organizationId: event.organizationId,
          studentId: { in: event.studentIds },
          OR: [{ canViewSchoolInfo: true }, { canReceiveSms: true }],
        },
        select: {
          studentId: true,
          canViewSchoolInfo: true,
          canReceiveSms: true,
          guardian: { select: { id: true, schoolId: true, phone: true, portalUserId: true } },
          student: { select: { firstName: true, firstNameAr: true, schoolId: true } },
        },
      }),
    ]);
    // Responsable et élève de l'établissement du fait seulement : après un transfert, ni l'ancien
    // responsable ni celui du nouvel établissement ne reçoivent un fait de l'autre établissement.
    const current = links.filter(
      (l) => l.guardian.schoolId === l.student.schoolId && l.student.schoolId === event.schoolId,
    );
    const portalUsers = [
      ...new Set(
        current
          .filter((l) => l.canViewSchoolInfo && l.guardian.portalUserId)
          .map((l) => l.guardian.portalUserId!),
      ),
    ];
    const active = new Set(
      (
        await db.schoolPortalAccount.findMany({
          where: {
            organizationId: event.organizationId,
            userId: { in: portalUsers },
            status: 'ACTIVE',
          },
          select: { userId: true },
        })
      ).map((a) => a.userId),
    );
    const notifications = current
      .filter((l) => l.canViewSchoolInfo && active.has(l.guardian.portalUserId ?? ''))
      .map((l) => ({
        organizationId: event.organizationId,
        schoolId: event.schoolId,
        userId: l.guardian.portalUserId!,
        studentId: l.studentId,
        kind: event.kind,
        resourceId: event.resourceId,
        params: event.params ?? {},
        dedupeKey: event.dedupe(l.studentId),
      }));
    if (notifications.length > 0) {
      await db.schoolNotification.createMany({ data: notifications, skipDuplicates: true });
    }
    if (event.sms) {
      const sms = event.sms;
      const locale: SchoolLocale = school.defaultLocale;
      const schoolName = locale === 'AR' ? school.nameAr || school.name : school.name;
      const messages: SmsToSend[] = current
        .filter((l) => l.canReceiveSms)
        .map((l) => ({
          organizationId: event.organizationId,
          schoolId: event.schoolId,
          guardianId: l.guardian.id,
          studentId: l.studentId,
          phone: l.guardian.phone,
          kind: sms.kind,
          body: smsText(sms.kind, locale, {
            school: schoolName,
            firstName:
              locale === 'AR' ? l.student.firstNameAr || l.student.firstName : l.student.firstName,
            date: sms.date,
          }),
          dedupeKey: `${event.dedupe(l.studentId)}:${l.guardian.id}`,
        }));
      await this.sms.enqueue(db, messages);
    }
  }

  /** Notifications d'une annonce, pour les comptes déjà résolus par le service des annonces. */
  /**
   * Élèves que le portail montre dans une classe : inscription validée dans la classe pour l'année en
   * cours ; pour un groupe, membres d'un groupe actif. Les destinataires d'un fait de planning ne sont
   * jamais ceux d'une inscription future ou d'un groupe que le portail n'affiche pas.
   */
  async portalStudents(
    db: Db,
    organizationId: string,
    classId: string,
    groupId: string | null,
  ): Promise<string[]> {
    const rows = await db.schoolStudent.findMany({
      where: {
        organizationId,
        enrollments: { some: { classId, status: 'VALIDATED', year: { status: 'ACTIVE' } } },
        ...(groupId ? { groups: { some: { groupId, group: { isActive: true } } } } : {}),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async notifyUsers(
    db: Db,
    rows: {
      organizationId: string;
      schoolId: string;
      userId: string;
      studentId: string | null;
      kind: SchoolNotificationKind;
      resourceId: string;
      dedupeKey: string;
      params?: Record<string, string>;
    }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await db.schoolNotification.createMany({
      data: rows.map((r) => ({ ...r, params: r.params ?? {} })),
      skipDuplicates: true,
    });
  }

  /**
   * Échéances impayées : date limite dépassée dans le fuseau de l'établissement et un reste à payer. Une
   * seule notification (et un seul SMS) par échéance, même si le contrôle repasse. Parcours par curseur :
   * des échéances sans destinataire éligible n'empêchent jamais le traitement des suivantes. Ne lève jamais.
   */
  async scanOverdue(organizationId?: string): Promise<number> {
    let notified = 0;
    try {
      const schools = await this.db.school.findMany({
        where: { isActive: true, ...(organizationId ? { organizationId } : {}) },
        select: { id: true, organizationId: true, timezone: true },
      });
      for (const school of schools) {
        const day = today(school.timezone);
        let after: { dueOn: string; id: string } | null = null;
        for (;;) {
          const cursor: Prisma.Sql = after
            ? Prisma.sql`AND (c."dueOn", c.id) > (${after.dueOn}::date, ${after.id}::uuid)`
            : Prisma.empty;
          const overdue = await this.db.$queryRaw<
            { id: string; studentId: string; label: string; dueOn: string }[]
          >`
          SELECT c.id, c."studentId", c.label, c."dueOn"::text AS "dueOn" FROM "SchoolCharge" c
          WHERE c."organizationId" = ${school.organizationId}::uuid AND c."schoolId" = ${school.id}::uuid
            AND c."dueOn" < ${day}::date ${cursor}
            AND c."amount" - c."discount" + c."adjustment" > c."paid"
            AND NOT EXISTS (
              SELECT 1 FROM "SchoolNotification" n
              WHERE n."organizationId" = c."organizationId" AND n."resourceId" = c.id
                AND n.kind = 'CHARGE_OVERDUE')
            AND NOT EXISTS (
              SELECT 1 FROM "SchoolSmsMessage" m
              WHERE m."organizationId" = c."organizationId"
                AND m."dedupeKey" LIKE 'charge-overdue:' || c.id::text || ':%')
          ORDER BY c."dueOn", c.id LIMIT ${OVERDUE_BATCH}`;
          for (const charge of overdue) {
            // Notification et SMS d'une échéance écrits ensemble : une interruption n'en laisse
            // jamais un seul, qui exclurait l'échéance des contrôles suivants.
            const sent = await this.db.$transaction(async (tx) => {
              // Échéance relue sous verrou partagé : un règlement validé entre-temps l'a soldée, un
              // règlement en cours attend le rappel (seul verrou pris ici : aucun cycle avec la caisse).
              const [still] = await tx.$queryRaw<{ id: string }[]>`
                SELECT id FROM "SchoolCharge"
                WHERE id = ${charge.id}::uuid AND "dueOn" < ${day}::date
                  AND "amount" - "discount" + "adjustment" > "paid"
                FOR SHARE`;
              if (!still) return false;
              await this.notifyStudents(tx, {
                organizationId: school.organizationId,
                schoolId: school.id,
                kind: 'CHARGE_OVERDUE',
                resourceId: charge.id,
                studentIds: [charge.studentId],
                params: { charge: charge.label },
                dedupe: () => `charge-overdue:${charge.id}`,
                sms: { kind: 'CHARGE_OVERDUE' },
              });
              return true;
            });
            if (sent) notified += 1;
          }
          if (overdue.length < OVERDUE_BATCH) break;
          const last = overdue[overdue.length - 1]!;
          after = { dueOn: last.dueOn, id: last.id };
        }
      }
    } catch (error) {
      this.logger.warn(`Contrôle des échéances impayées interrompu : ${(error as Error).name}`);
    }
    return notified;
  }

  // ─── Portail parents ───

  /** Notifications d'un compte, limitées à ses enfants et établissements autorisés aujourd'hui. */
  async list(userId: string, scope: PortalScope, unreadOnly: boolean, cursor?: string) {
    const rows = await this.db.schoolNotification.findMany({
      where: { userId, ...this.inScope(scope), ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PAGE + 1,
      select: {
        id: true,
        kind: true,
        studentId: true,
        params: true,
        readAt: true,
        createdAt: true,
      },
    });
    const items = rows.slice(0, PAGE).map((n) => ({
      ...n,
      href: portalNotificationHref(n.kind, n.studentId),
    }));
    const unread = await this.db.schoolNotification.count({
      where: { userId, readAt: null, ...this.inScope(scope) },
    });
    return {
      items,
      unread,
      nextCursor: rows.length > PAGE ? items[items.length - 1]!.id : null,
    };
  }

  async unreadCount(userId: string, scope: PortalScope): Promise<number> {
    return this.db.schoolNotification.count({
      where: { userId, readAt: null, ...this.inScope(scope) },
    });
  }

  async markRead(userId: string, scope: PortalScope, id: string): Promise<void> {
    const { count } = await this.db.schoolNotification.updateMany({
      where: { id, userId, ...this.inScope(scope) },
      data: { readAt: new Date() },
    });
    if (count === 0) throw new NotFoundException(NOT_FOUND);
  }

  async markAllRead(userId: string, scope: PortalScope): Promise<void> {
    await this.db.schoolNotification.updateMany({
      where: { userId, readAt: null, ...this.inScope(scope) },
      data: { readAt: new Date() },
    });
  }

  /**
   * Une notification d'élève exige l'enfant autorisé ; une notification d'annonce, une annonce qui vise
   * encore l'un des enfants autorisés (ciblage recalculé à chaque requête).
   */
  private inScope(scope: PortalScope): Prisma.SchoolNotificationWhereInput {
    return {
      OR: [
        { studentId: { in: scope.studentIds } },
        { studentId: null, kind: 'ANNOUNCEMENT', resourceId: { in: scope.announcementIds } },
      ],
    };
  }
}
