import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  SCHOOL_INVITATION_TTL_DAYS,
  type SchoolLocale,
  schoolAccessIn,
  smsText,
} from '@ocall/shared';
import type { RequestMeta } from '../../common/request-meta';
import { PasswordService } from '../../common/security/password.service';
import { PortalAccounts, type PortalAccountSource } from '../../common/security/portal-accounts';
import { SessionService } from '../../common/security/session.service';
import { generateToken, hashToken } from '../../common/security/tokens';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import {
  type ProductEntitlement,
  SuiteContractsService,
} from '../suite-contracts/suite-contracts.service';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolSmsService } from './school-sms.service';
import { SchoolService } from './school.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const SCHOOL_PRODUCT_CODE = 'OCALL_SCHOOL';
const INVALID_INVITATION = {
  code: 'INVALID_INVITATION',
  message: 'Lien d’activation invalide, expiré ou déjà utilisé.',
};

/** Enfant autorisé d'un compte du portail, avec son établissement et sa classe actuelle. */
export interface PortalChild {
  id: string;
  organizationId: string;
  schoolId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
  school: {
    id: string;
    name: string;
    nameAr: string | null;
    defaultLocale: SchoolLocale;
    timezone: string;
  };
  class: { id: string; name: string; nameAr: string | null; schoolYearId: string } | null;
  /** Fiches responsables de ce compte reliées à l'enfant (ciblage des annonces). */
  guardianIds: string[];
  /** Contrat de l'établissement : en lecture seule, aucune soumission (justificatif). */
  access: 'full' | 'read_only';
}

export type InvitationStatus = 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';

/**
 * Comptes du portail parents (Sprint 6). L'établissement invite un responsable : lien à usage unique,
 * expirant, révocable. L'activation crée (ou réactive) un compte Suite sans adhésion, déclaré au cœur de
 * l'authentification comme compte de portail. Les enfants visibles ne viennent que des liens que
 * l'établissement a autorisés (`canViewSchoolInfo`) : un parent ne rattache jamais seul un élève.
 */
@Injectable()
export class SchoolPortalAccountsService implements OnModuleInit, PortalAccountSource {
  readonly kind = 'guardian' as const;

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly core: PrismaService,
    private readonly school: SchoolService,
    private readonly sms: SchoolSmsService,
    private readonly contracts: SuiteContractsService,
    private readonly provisioning: OrganizationProvisioningService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly portals: PortalAccounts,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.school.enabled) this.portals.register(this);
  }

  /** Compte actif sur au moins une organisation active dont le contrat School donne encore accès. */
  async isActive(userId: string): Promise<boolean> {
    return (await this.organizationsOf(userId)).size > 0;
  }

  /**
   * Organisations où ce compte est actif, l'organisation n'est pas suspendue dans Ocall Suite et le
   * contrat School donne encore accès, avec les établissements couverts (vide : tous). Relu à chaque
   * requête : une suspension ou une réduction du contrat prend effet immédiatement.
   */
  private async organizationsOf(userId: string): Promise<Map<string, ProductEntitlement>> {
    const accounts = await this.db.schoolPortalAccount.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { organizationId: true },
    });
    const result = new Map<string, ProductEntitlement>();
    if (accounts.length === 0) return result;
    const active = await this.core.organization.findMany({
      where: { id: { in: accounts.map((a) => a.organizationId) }, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const { id } of active) {
      const entitlement = await this.contracts.entitlement(id, SCHOOL_PRODUCT_CODE);
      if (entitlement.access !== 'none') {
        result.set(id, entitlement);
      }
    }
    return result;
  }

  // ─── Établissement : invitations et révocations ───

  /** État du portail pour un responsable : compte, invitations, enfants autorisés. */
  async status(ctx: SchoolContext, guardianId: string) {
    const guardian = await this.findGuardian(ctx, guardianId);
    const [invitations, account, authorized] = await Promise.all([
      this.db.schoolGuardianInvitation.findMany({
        where: { organizationId: ctx.organizationId, guardianId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, expiresAt: true, usedAt: true, revokedAt: true, createdAt: true },
      }),
      guardian.portalUserId
        ? this.db.schoolPortalAccount.findUnique({
            where: {
              organizationId_userId: {
                organizationId: ctx.organizationId,
                userId: guardian.portalUserId,
              },
            },
            select: { status: true, activatedAt: true, revokedAt: true },
          })
        : null,
      this.db.schoolStudentGuardian.count({
        where: { organizationId: ctx.organizationId, guardianId, canViewSchoolInfo: true },
      }),
    ]);
    const loginId = guardian.portalUserId
      ? (
          await this.core.user.findUnique({
            where: { id: guardian.portalUserId },
            select: { loginId: true },
          })
        )?.loginId
      : null;
    return {
      account: guardian.portalUserId && account ? { ...account, loginId: loginId ?? null } : null,
      authorizedChildren: authorized,
      invitations: invitations.map((i) => ({
        id: i.id,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        status: invitationStatus(i),
      })),
    };
  }

  /**
   * Invitation au portail : l'ancienne invitation non utilisée est révoquée, le lien en clair n'est
   * renvoyé qu'une fois (jamais stocké) et peut partir par SMS si l'établissement les a activés.
   */
  async invite(ctx: SchoolContext, guardianId: string, sendSms: boolean) {
    const guardian = await this.findGuardian(ctx, guardianId);
    const authorized = await this.db.schoolStudentGuardian.count({
      where: { organizationId: ctx.organizationId, guardianId, canViewSchoolInfo: true },
    });
    if (authorized === 0) {
      throw new ConflictException({
        code: 'NO_AUTHORIZED_CHILD',
        message:
          'Ce responsable n’est autorisé à suivre aucun enfant : autorisez d’abord le suivi sur la fiche de l’élève.',
      });
    }
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SCHOOL_INVITATION_TTL_DAYS * 86_400_000);
    const path = `/parents/activation?token=${token}`;
    const school = await this.db.school.findUniqueOrThrow({
      where: { id: guardian.schoolId },
      select: { name: true, nameAr: true, defaultLocale: true },
    });
    const smsQueued = await this.db.$transaction(async (tx) => {
      // Ordre commun à l'activation et aux révocations : le responsable, puis ses invitations. Deux
      // invitations simultanées se suivent : la seconde révoque la première.
      await this.lockGuardian(tx, guardianId);
      await tx.schoolGuardianInvitation.updateMany({
        where: { organizationId: ctx.organizationId, guardianId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const invitation = await tx.schoolGuardianInvitation.create({
        data: {
          organizationId: ctx.organizationId,
          schoolId: guardian.schoolId,
          guardianId,
          tokenHash: hashToken(token),
          expiresAt,
          createdByUserId: ctx.userId,
        },
      });
      await this.school.recordDecision(
        tx,
        ctx,
        'school.portal_invitation_created',
        'SchoolGuardian',
        guardianId,
        { invitationId: invitation.id },
      );
      // Le lien par SMS exige l'adresse publique du portail ; sans elle, l'établissement le remet.
      if (!sendSms || !this.config.school.portalBaseUrl) return false;
      const locale: SchoolLocale = school.defaultLocale;
      const queued = await this.sms.enqueue(tx, [
        {
          organizationId: ctx.organizationId,
          schoolId: guardian.schoolId,
          guardianId: guardian.id,
          phone: guardian.phone,
          kind: 'INVITATION',
          body: smsText('INVITATION', locale, {
            school: locale === 'AR' ? school.nameAr || school.name : school.name,
            url: `${this.config.school.portalBaseUrl}${path}`,
          }),
          dedupeKey: `invitation:${invitation.id}`,
        },
      ]);
      return queued > 0;
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { path, expiresAt, smsQueued };
  }

  async revokeInvitation(ctx: SchoolContext, guardianId: string, invitationId: string) {
    await this.findGuardian(ctx, guardianId);
    const { count } = await this.db.schoolGuardianInvitation.updateMany({
      where: {
        id: invitationId,
        organizationId: ctx.organizationId,
        guardianId,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException(NOT_FOUND);
    await this.school.log(ctx, 'school.portal_invitation_revoked', 'SchoolGuardian', guardianId, {
      invitationId,
    });
    return { revoked: true };
  }

  /**
   * Retire l'accès au portail de cette fiche responsable : elle n'est plus reliée au compte, ses enfants
   * disparaissent du portail ; le compte de l'organisation n'est révoqué que s'il ne suit plus aucune
   * fiche (une fiche d'un autre établissement, hors périmètre, n'est jamais touchée).
   */
  async revokeAccess(ctx: SchoolContext, guardianId: string, reason: string) {
    await this.findGuardian(ctx, guardianId);
    const accountRevoked = await this.db.$transaction(async (tx) => {
      await this.lockGuardian(tx, guardianId);
      // Compte relu sous verrou : une activation concurrente a pu le relier entre-temps.
      const { portalUserId: userId } = await tx.schoolGuardian.findUniqueOrThrow({
        where: { id: guardianId },
        select: { portalUserId: true },
      });
      if (!userId) throw new NotFoundException(NOT_FOUND);
      await tx.schoolGuardian.update({ where: { id: guardianId }, data: { portalUserId: null } });
      await tx.schoolGuardianInvitation.updateMany({
        where: { organizationId: ctx.organizationId, guardianId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const remaining = await tx.schoolGuardian.count({
        where: { organizationId: ctx.organizationId, portalUserId: userId },
      });
      if (remaining === 0) {
        await tx.schoolPortalAccount.updateMany({
          where: { organizationId: ctx.organizationId, userId, status: 'ACTIVE' },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            revokedByUserId: ctx.userId,
            revokeReason: reason,
          },
        });
      }
      await this.school.recordDecision(
        tx,
        ctx,
        'school.portal_access_revoked',
        'SchoolGuardian',
        guardianId,
        { accountRevoked: remaining === 0 },
      );
      return remaining === 0;
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { revoked: true, accountRevoked };
  }

  // ─── Activation (publique, par le lien) ───

  /** Vérifie un lien sans le consommer : prénom du responsable et établissement, rien de plus. */
  async checkInvitation(token: string) {
    const invitation = await this.db.schoolGuardianInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        guardian: {
          select: {
            firstName: true,
            portalUserId: true,
            school: { select: { name: true, nameAr: true, defaultLocale: true } },
          },
        },
      },
    });
    if (!invitation) return { status: 'INVALID' as const };
    const status = invitationStatus(invitation);
    if (status !== 'PENDING') return { status };
    return {
      status,
      firstName: invitation.guardian.firstName,
      school: invitation.guardian.school,
      existingAccount: invitation.guardian.portalUserId !== null,
    };
  }

  /**
   * Active le compte : jeton consommé une seule fois sous verrou ; compte Suite créé (identifiant de
   * l'organisation, aucune adhésion) ou, s'il existe déjà, nouveau mot de passe et sessions fermées.
   */
  async activate(token: string, password: string, meta: RequestMeta) {
    this.passwords.assertPolicy(password);
    const passwordHash = await this.passwords.hash(password);
    const tokenHash = hashToken(token);
    const target = await this.db.schoolGuardianInvitation.findUnique({
      where: { tokenHash },
      select: { guardianId: true },
    });
    if (!target) throw new ForbiddenException(INVALID_INVITATION);
    let createdUserId: string | null = null;
    let result: { organizationId: string; userId: string; loginId: string };
    try {
      result = await this.db.$transaction(async (tx) => {
        // Même ordre que l'invitation et les révocations : le responsable, puis l'invitation.
        await this.lockGuardian(tx, target.guardianId);
        const [row] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "SchoolGuardianInvitation" WHERE "tokenHash" = ${tokenHash}
          FOR UPDATE`;
        if (!row) throw new ForbiddenException(INVALID_INVITATION);
        const invitation = await tx.schoolGuardianInvitation.findUniqueOrThrow({
          where: { id: row.id },
        });
        if (invitationStatus(invitation) !== 'PENDING') {
          throw new ForbiddenException(INVALID_INVITATION);
        }
        const fresh = await tx.schoolGuardian.findUniqueOrThrow({
          where: { id: invitation.guardianId },
        });
        let userId = fresh.portalUserId;
        let loginId: string;
        const existing = userId ? await this.core.user.findUnique({ where: { id: userId } }) : null;
        if (existing) {
          await this.core.user.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              mustChangePassword: false,
              passwordChangedAt: new Date(),
              failedLoginCount: 0,
              lockedUntil: null,
              isActive: true,
            },
          });
          await this.sessions.revokeAllForUser(existing.id);
          loginId = existing.loginId;
        } else {
          const emailFree =
            fresh.email &&
            !(await this.core.user.findFirst({
              where: { email: fresh.email.toLowerCase() },
              select: { id: true },
            }));
          const user = await this.core.$transaction(async (core) => {
            const allocated = await this.provisioning.allocateLoginId(
              core,
              invitation.organizationId,
            );
            return core.user.create({
              data: {
                firstName: fresh.firstName,
                lastName: fresh.lastName,
                email: emailFree ? fresh.email!.toLowerCase() : null,
                loginId: allocated,
                passwordHash,
                mustChangePassword: false,
                passwordChangedAt: new Date(),
              },
            });
          });
          createdUserId = user.id;
          userId = user.id;
          loginId = user.loginId;
          await tx.schoolGuardian.update({
            where: { id: fresh.id },
            data: { portalUserId: user.id },
          });
        }
        await tx.schoolGuardianInvitation.update({
          where: { id: invitation.id },
          data: { usedAt: new Date() },
        });
        await tx.schoolPortalAccount.upsert({
          where: {
            organizationId_userId: { organizationId: invitation.organizationId, userId: userId! },
          },
          create: { organizationId: invitation.organizationId, userId: userId! },
          update: {
            status: 'ACTIVE',
            activatedAt: new Date(),
            revokedAt: null,
            revokedByUserId: null,
            revokeReason: null,
          },
        });
        // Journal écrit dans la même transaction, publié ensuite et repris en cas d'échec.
        await tx.schoolAccessDecision.create({
          data: {
            organizationId: invitation.organizationId,
            actorUserId: userId!,
            action: 'school.portal_activated',
            targetType: 'User',
            targetId: userId!,
            metadata: { invitationId: invitation.id, ipAddress: meta.ipAddress ?? null },
          },
        });
        return { organizationId: invitation.organizationId, userId: userId!, loginId };
      });
    } catch (error) {
      // Compte Suite créé mais activation School annulée : le compte, sans portail, est désactivé.
      // Seuls les échecs antérieurs au commit School arrivent ici.
      if (createdUserId) {
        await this.core.user
          .update({ where: { id: createdUserId }, data: { isActive: false } })
          .catch(() => undefined);
      }
      throw error;
    }
    await this.school.publishDecisions(result.organizationId);
    return { loginId: result.loginId };
  }

  // ─── Portail : enfants autorisés ───

  /**
   * Enfants qu'un compte peut suivre : organisations où son compte est actif et dont le contrat donne
   * encore accès, liens autorisés par l'établissement, élève du même établissement que la fiche, hors
   * transfert. Relu à chaque requête : une révocation prend effet immédiatement.
   */
  async children(userId: string): Promise<PortalChild[]> {
    const access = await this.organizationsOf(userId);
    if (access.size === 0) return [];
    const links = await this.db.schoolStudentGuardian.findMany({
      where: {
        organizationId: { in: [...access.keys()] },
        canViewSchoolInfo: true,
        guardian: { portalUserId: userId },
        student: { status: { not: 'TRANSFERRED' }, school: { isActive: true } },
      },
      select: {
        guardian: { select: { id: true, schoolId: true } },
        student: {
          select: {
            id: true,
            organizationId: true,
            schoolId: true,
            matricule: true,
            lastName: true,
            firstName: true,
            lastNameAr: true,
            firstNameAr: true,
            school: {
              select: { id: true, name: true, nameAr: true, defaultLocale: true, timezone: true },
            },
            enrollments: {
              where: { status: 'VALIDATED', year: { status: 'ACTIVE' } },
              select: {
                class: { select: { id: true, name: true, nameAr: true, schoolYearId: true } },
              },
              take: 1,
            },
          },
        },
      },
    });
    const byStudent = new Map<string, PortalChild>();
    for (const { guardian, student } of links) {
      if (guardian.schoolId !== student.schoolId) continue;
      // Accès selon le contrat de l'établissement de l'enfant (contrats multiples) : actif = écriture
      // (justificatif), suspendu ou expiré = consultation, hors de tout contrat = inaccessible.
      const schoolAccess = schoolAccessIn(access.get(student.organizationId)!, student.schoolId);
      if (schoolAccess === 'none') continue;
      const known = byStudent.get(student.id);
      if (known) {
        known.guardianIds.push(guardian.id);
        continue;
      }
      const { enrollments, ...rest } = student;
      byStudent.set(student.id, {
        ...rest,
        class: enrollments[0]?.class ?? null,
        guardianIds: [guardian.id],
        access: schoolAccess,
      });
    }
    return [...byStudent.values()].sort(
      (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName),
    );
  }

  /** Enfant autorisé, sinon introuvable : aucun indice sur l'existence d'un autre élève. */
  async child(userId: string, studentId: string): Promise<PortalChild> {
    const child = (await this.children(userId)).find((c) => c.id === studentId);
    if (!child) throw new NotFoundException(NOT_FOUND);
    return child;
  }

  /** Verrou de la fiche responsable, toujours pris avant celui de ses invitations. */
  private async lockGuardian(tx: Prisma.TransactionClient, guardianId: string) {
    await tx.$queryRaw`SELECT id FROM "SchoolGuardian" WHERE id = ${guardianId}::uuid FOR UPDATE`;
  }

  private async findGuardian(ctx: SchoolContext, id: string) {
    const guardian = await this.db.schoolGuardian.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, schoolId: true, phone: true, email: true, portalUserId: true },
    });
    if (!guardian) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, guardian.schoolId);
    return guardian;
  }
}

function invitationStatus(i: {
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}): InvitationStatus {
  if (i.usedAt) return 'USED';
  if (i.revokedAt) return 'REVOKED';
  if (i.expiresAt <= new Date()) return 'EXPIRED';
  return 'PENDING';
}
