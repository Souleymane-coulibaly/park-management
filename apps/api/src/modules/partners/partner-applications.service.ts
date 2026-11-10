import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  PARTNER_INVITATION_TTL_DAYS,
  demoSpamReason,
  normalizeEmail,
  phoneMatchKey,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import { MailService } from '../../common/mail/mail.service';
import {
  applicationReceivedMail,
  applicationRejectedMail,
  invitationMail,
  newApplicationAlertMail,
} from '../../common/mail/partner-mails';
import type { AuthContext } from '../../common/auth-context';
import { nextPlatformSequence } from '../../common/platform-counter';
import { PasswordService } from '../../common/security/password.service';
import { generateToken, hashToken } from '../../common/security/tokens';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { uniquePartnerCode } from './partner-code';
import type { PartnerApplicationDto, PartnerApplicationsQueryDto } from './partners.dto';

const DAY_MS = 86_400_000;
const PAGE = 50;
const INVALID_INVITATION = {
  code: 'INVALID_PARTNER_INVITATION',
  message: 'Lien d’invitation invalide, expiré ou déjà utilisé.',
};

type InvitationState = 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';
const invitationState = (i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) =>
  i.usedAt
    ? 'USED'
    : i.revokedAt
      ? 'REVOKED'
      : i.expiresAt.getTime() <= Date.now()
        ? 'EXPIRED'
        : ('PENDING' as InvitationState);

/**
 * Candidatures publiques Ocall Partner (Sprint S3) : dépôt sans compte, examen par Ocall, invitation
 * à usage unique pour créer le compte partenaire (actif dès sa création ; double authentification à la
 * première connexion). Jamais de compte créé à la candidature, jamais de jeton stocké en clair ni
 * journalisé, aucune énumération publique des candidats.
 */
@Injectable()
export class PartnerApplicationsService {
  private readonly logger = new Logger('PartnerApplications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ─── Public ───

  /**
   * Dépôt public. Même réponse dans tous les cas (robot détecté, candidature déjà en attente, adresse
   * déjà partenaire) : aucune information sur l'existence d'un candidat.
   */
  async submit(dto: PartnerApplicationDto): Promise<{ received: true }> {
    const spam = demoSpamReason({ website: dto.website, startedAt: dto.startedAt });
    if (spam) {
      this.logger.warn(`Candidature partenaire ignorée (${spam}).`);
      return { received: true };
    }
    const emailNormalized = normalizeEmail(dto.email)!;
    const retentionUntil = new Date();
    retentionUntil.setUTCMonth(
      retentionUntil.getUTCMonth() + this.config.partnerApplicationRetentionMonths,
    );
    let created: { id: string; number: string } | null = null;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const { year, sequence } = await nextPlatformSequence(tx, 'partner-application');
        const created = await tx.partnerApplication.create({
          data: {
            number: `CAND-${year}-${String(sequence).padStart(5, '0')}`,
            type: dto.type,
            firstName: dto.firstName,
            lastName: dto.lastName,
            company: dto.company ?? null,
            email: dto.email,
            emailNormalized,
            phone: dto.phone,
            phoneNormalized: phoneMatchKey(dto.phone),
            country: dto.country,
            city: dto.city,
            experience: dto.experience,
            targetSectors: dto.targetSectors,
            motivation: dto.motivation,
            consentAt: new Date(),
            retentionUntil,
          },
          select: { id: true, number: true },
        });
        // Journal sans données personnelles.
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: null,
            action: 'platform.partner_application_received',
            targetType: 'PartnerApplication',
            targetId: created.id,
            metadata: { number: created.number, type: dto.type, country: dto.country },
          },
          tx,
        );
        return created;
      });
    } catch (e) {
      // Candidature déjà en attente pour cette adresse (index unique partiel) : réponse identique.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    if (created) {
      // Après validation : accusé de réception au candidat, alerte à l'équipe Ocall. Jamais bloquant.
      await Promise.all([
        this.mail.send({
          to: [dto.email],
          tag: 'partner-application-received',
          idempotencyKey: `partner-application-received/${created.id}`,
          ...applicationReceivedMail({
            firstName: dto.firstName,
            number: created.number,
            type: dto.type,
          }),
        }),
        this.mail.send({
          to: this.mail.partnerAlertRecipients,
          tag: 'partner-application-alert',
          idempotencyKey: `partner-application-alert/${created.id}`,
          ...newApplicationAlertMail(
            { number: created.number, type: dto.type, city: dto.city, country: dto.country },
            `${this.mail.webBaseUrl}/admin/partenaires/candidatures`,
          ),
        }),
      ]);
    }
    return { received: true };
  }

  /** Vérifie un lien d'invitation sans le consommer (aucune donnée personnelle renvoyée). */
  async checkInvitation(token: string) {
    const invitation = await this.prisma.partnerInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        application: { select: { firstName: true, type: true } },
      },
    });
    if (!invitation) throw new ForbiddenException(INVALID_INVITATION);
    const state = invitationState(invitation);
    return {
      status: state,
      firstName: state === 'PENDING' ? invitation.application.firstName : null,
      type: state === 'PENDING' ? invitation.application.type : null,
    };
  }

  /**
   * Création du compte partenaire depuis l'invitation : invitation verrouillée, vérifiée puis consommée
   * dans la même transaction (usage unique, même sous deux envois simultanés). Le partenaire est actif ;
   * la double authentification est exigée à sa première connexion.
   */
  async activate(token: string, password: string) {
    this.passwords.assertPolicy(password);
    const passwordHash = await this.passwords.hash(password);
    const tokenHash = hashToken(token);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "PartnerInvitation" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
        if (!row) throw new ForbiddenException(INVALID_INVITATION);
        const invitation = await tx.partnerInvitation.findUniqueOrThrow({
          where: { id: row.id },
          include: { application: { include: { partner: { select: { id: true } } } } },
        });
        const app = invitation.application;
        if (invitationState(invitation) !== 'PENDING' || app.status !== 'APPROVED' || app.partner) {
          throw new ForbiddenException(INVALID_INVITATION);
        }
        if (
          await tx.user.findUnique({ where: { email: app.emailNormalized }, select: { id: true } })
        ) {
          throw new ConflictException({
            code: 'EMAIL_TAKEN',
            message: 'Un compte existe déjà avec cette adresse : contactez Ocall.',
          });
        }
        const user = await tx.user.create({
          data: {
            firstName: app.firstName,
            lastName: app.lastName,
            email: app.emailNormalized,
            loginId: app.emailNormalized.toUpperCase(),
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
          },
          select: { id: true, loginId: true },
        });
        const partner = await tx.partner.create({
          data: {
            userId: user.id,
            code: await uniquePartnerCode(tx),
            type: app.type,
            companyName: app.company ?? `${app.firstName} ${app.lastName}`,
            contactName: `${app.firstName} ${app.lastName}`,
            phone: app.phone,
            country: app.country,
            city: app.city,
            // L'approbation d'Ocall vaut agrément : actif sans seconde vérification (décision client).
            status: 'ACTIVE',
            verifiedAt: app.decidedAt,
            verifiedById: app.decidedById,
            applicationId: app.id,
            createdById: app.decidedById ?? invitation.createdById,
          },
          select: { id: true, code: true },
        });
        await tx.partnerInvitation.update({
          where: { id: invitation.id },
          data: { usedAt: new Date() },
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: user.id,
            action: 'partner.account_activated',
            targetType: 'Partner',
            targetId: partner.id,
            metadata: { applicationId: app.id, code: partner.code, type: app.type },
          },
          tx,
        );
        return { loginId: user.loginId, mfaRequired: true };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ForbiddenException(INVALID_INVITATION);
      }
      throw e;
    }
  }

  // ─── Super Admin ───

  async list(q: PartnerApplicationsQueryDto) {
    const where: Prisma.PartnerApplicationWhereInput = {
      anonymizedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.country ? { country: q.country } : {}),
      ...(q.q
        ? {
            OR: [
              { lastName: { contains: q.q, mode: 'insensitive' } },
              { firstName: { contains: q.q, mode: 'insensitive' } },
              { company: { contains: q.q, mode: 'insensitive' } },
              { number: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const page = q.page ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.partnerApplication.findMany({
        where,
        orderBy: [{ createdAt: q.status === 'PENDING' ? 'asc' : 'desc' }, { id: 'asc' }],
        skip: page * PAGE,
        take: PAGE,
        include: {
          partner: { select: { id: true, code: true, status: true } },
          invitations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { expiresAt: true, usedAt: true, revokedAt: true, createdAt: true },
          },
        },
      }),
      this.prisma.partnerApplication.count({ where }),
    ]);
    return {
      items: items.map(({ invitations, ...a }) => ({
        ...a,
        invitation: invitations[0]
          ? { ...invitations[0], status: invitationState(invitations[0]) }
          : null,
      })),
      total,
      page,
      pageSize: PAGE,
    };
  }

  countPending(): Promise<number> {
    return this.prisma.partnerApplication.count({
      where: { status: 'PENDING', anonymizedAt: null },
    });
  }

  /** Approbation (vaut agrément) puis invitation : le lien n'est renvoyé qu'une fois, ici. */
  async approve(auth: AuthContext, id: string, note: string | null) {
    const result = await this.prisma.$transaction(async (tx) => {
      const app = await this.find(tx, id);
      if (
        await tx.user.findUnique({ where: { email: app.emailNormalized }, select: { id: true } })
      ) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'Un compte Ocall existe déjà avec cette adresse.',
        });
      }
      const moved = await tx.partnerApplication.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          decidedById: auth.user.id,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      if (moved.count !== 1) {
        throw new ConflictException({
          code: 'APPLICATION_NOT_PENDING',
          message: 'Cette candidature a déjà été examinée.',
        });
      }
      const invitation = await this.issueInvitation(tx, auth, id);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.partner_application_approved',
          targetType: 'PartnerApplication',
          targetId: id,
          metadata: { number: app.number, type: app.type },
        },
        tx,
      );
      return { app, invitation };
    });
    const emailSent = await this.sendInvitation(result.app, result.invitation);
    return {
      id,
      status: 'APPROVED' as const,
      invitationPath: result.invitation.path,
      emailSent,
    };
  }

  async reject(auth: AuthContext, id: string, note: string) {
    const app = await this.prisma.$transaction(async (tx) => {
      const app = await this.find(tx, id);
      const moved = await tx.partnerApplication.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          decidedById: auth.user.id,
          decidedAt: new Date(),
          decisionNote: note,
        },
      });
      if (moved.count !== 1) {
        throw new ConflictException({
          code: 'APPLICATION_NOT_PENDING',
          message: 'Cette candidature a déjà été examinée.',
        });
      }
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.partner_application_rejected',
          targetType: 'PartnerApplication',
          targetId: id,
          metadata: { number: app.number },
        },
        tx,
      );
      return app;
    });
    // Refus motivé communiqué au candidat (le motif saisi lui est destiné).
    const emailSent = await this.mail.send({
      to: [app.email],
      tag: 'partner-application-rejected',
      idempotencyKey: `partner-application-rejected/${id}`,
      ...applicationRejectedMail(app, note),
    });
    return { id, status: 'REJECTED' as const, emailSent };
  }

  /** Nouvelle invitation (lien perdu ou expiré) : la précédente est révoquée. */
  async reinvite(auth: AuthContext, id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PartnerApplication" WHERE id = ${id}::uuid FOR UPDATE`;
      const app = await tx.partnerApplication.findUnique({
        where: { id },
        include: { partner: { select: { id: true } } },
      });
      if (!app)
        throw new NotFoundException({
          code: 'APPLICATION_NOT_FOUND',
          message: 'Candidature introuvable.',
        });
      if (app.status !== 'APPROVED' || app.partner) {
        throw new ConflictException({
          code: 'APPLICATION_NOT_INVITABLE',
          message: 'Seule une candidature approuvée, sans compte créé, peut être réinvitée.',
        });
      }
      const invitation = await this.issueInvitation(tx, auth, id);
      await this.audit.record(
        {
          organizationId: null,
          actorUserId: auth.user.id,
          action: 'platform.partner_invitation_reissued',
          targetType: 'PartnerApplication',
          targetId: id,
          metadata: { number: app.number },
        },
        tx,
      );
      return { app, invitation };
    });
    const emailSent = await this.sendInvitation(result.app, result.invitation);
    return { id, invitationPath: result.invitation.path, emailSent };
  }

  /**
   * Invitation envoyée directement au candidat. Le lien reste aussi renvoyé une fois au Super Admin
   * (secours si l'e-mail n'arrive pas) ; il n'est jamais journalisé.
   */
  private sendInvitation(
    app: { email: string; firstName: string; type: 'REFERRER' | 'RESELLER' },
    invitation: { id: string; path: string; expiresAt: Date },
  ) {
    return this.mail.send({
      to: [app.email],
      tag: 'partner-invitation',
      idempotencyKey: `partner-invitation/${invitation.id}`,
      ...invitationMail(app, `${this.mail.webBaseUrl}${invitation.path}`, invitation.expiresAt),
    });
  }

  /**
   * Anonymisation des candidatures non retenues (ou jamais examinées) au-delà de la durée de
   * conservation. Les candidatures devenues partenaires sont conservées avec la fiche.
   */
  async purgeExpired(auth: AuthContext) {
    const now = new Date();
    const result = await this.prisma.partnerApplication.updateMany({
      where: {
        anonymizedAt: null,
        retentionUntil: { lte: now },
        partner: { is: null },
      },
      data: {
        firstName: 'Anonymisé',
        lastName: 'Anonymisé',
        company: null,
        email: 'anonymise@invalid',
        emailNormalized: 'anonymise@invalid',
        phone: '',
        phoneNormalized: '',
        city: '',
        experience: '',
        targetSectors: '',
        motivation: '',
        decisionNote: null,
        anonymizedAt: now,
        // Libère l'index « une candidature en attente par adresse ».
        status: 'REJECTED',
      },
    });
    await this.audit.record({
      organizationId: null,
      actorUserId: auth.user.id,
      action: 'platform.partner_applications_purged',
      targetType: 'PartnerApplication',
      targetId: null,
      metadata: { anonymized: result.count },
    });
    return { anonymized: result.count };
  }

  private async issueInvitation(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    applicationId: string,
  ) {
    const now = new Date();
    await tx.partnerInvitation.updateMany({
      where: { applicationId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const token = generateToken();
    const invitation = await tx.partnerInvitation.create({
      data: {
        applicationId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + PARTNER_INVITATION_TTL_DAYS * DAY_MS),
        createdById: auth.user.id,
      },
      select: { id: true, expiresAt: true },
    });
    // Chemin relatif : envoyé au candidat par e-mail et renvoyé une seule fois au Super Admin
    // (secours) ; jamais journalisé.
    return { ...invitation, path: `/activation-partenaire?token=${token}` };
  }

  private async find(tx: Prisma.TransactionClient, id: string) {
    const app = await tx.partnerApplication.findUnique({ where: { id } });
    if (!app || app.anonymizedAt) {
      throw new NotFoundException({
        code: 'APPLICATION_NOT_FOUND',
        message: 'Candidature introuvable.',
      });
    }
    return app;
  }
}
