import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@ocall/database';
import {
  KIOSK_PAIRING_ALPHABET,
  KIOSK_PAIRING_CODE_LENGTH,
  KIOSK_PAIRING_TTL_MINUTES,
  KIOSK_SESSION_MINUTES,
  KIOSK_TOKEN_TTL_DAYS,
  coversActivity,
} from '@ocall/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import type { TenantContext } from '../../common/auth-context';
import { generateToken, hashToken } from '../../common/security/tokens';
import { findSellingEstablishment } from '../pos/pos-scope';

const NOT_FOUND = { code: 'KIOSK_NOT_FOUND', message: 'Borne introuvable.' };
const UNPAIRED = {
  code: 'KIOSK_UNPAIRED',
  message:
    'Cette borne n’est pas (ou plus) appairée. Demandez un code d’appairage à un responsable.',
};

/** Borne authentifiée par son jeton d'appareil. */
export interface KioskContext {
  deviceId: string;
  deviceName: string;
  organizationId: string;
  establishmentId: string;
  establishmentName: string;
}

const DEVICE_SELECT = {
  id: true,
  name: true,
  isActive: true,
  pairedAt: true,
  revokedAt: true,
  lastSeenAt: true,
  tokenExpiresAt: true,
  pairingCodeExpiresAt: true,
  createdAt: true,
  establishment: { select: { id: true, name: true } },
} as const satisfies Prisma.KioskDeviceSelect;

type DeviceRow = Prisma.KioskDeviceGetPayload<{ select: typeof DEVICE_SELECT }>;

/** État affiché d'une borne (aucun secret n'est jamais renvoyé, sauf le code juste après création). */
function toDevice(d: DeviceRow) {
  const now = Date.now();
  const status = d.revokedAt
    ? 'REVOKED'
    : d.pairedAt && d.tokenExpiresAt && d.tokenExpiresAt.getTime() > now
      ? 'PAIRED'
      : d.pairingCodeExpiresAt && d.pairingCodeExpiresAt.getTime() > now
        ? 'AWAITING_PAIRING'
        : 'UNPAIRED';
  return { ...d, status };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Intervalle minimal entre deux mises à jour de lastSeenAt. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Bornes de commande libre-service.
 *
 * Sécurité :
 * - une borne est créée par un responsable (`kiosk.manage`) pour UN établissement restaurant ;
 * - elle est appairée avec un code à usage unique (8 caractères, 15 minutes) ; elle reçoit alors un
 *   jeton aléatoire de 256 bits, transmis dans un cookie httpOnly limité aux routes /api/v1/kiosk ;
 * - seuls les hash SHA-256 du code et du jeton sont stockés ; le jeton expire (180 jours) ;
 * - révocation immédiate (le jeton est effacé) ; le jeton ne donne accès à aucune route
 *   d'administration (il n'est pas une session d'employé).
 */
@Injectable()
export class KioskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Administration ───

  async list(auth: TenantContext, establishmentId: string) {
    await findSellingEstablishment(this.prisma, auth, establishmentId, 'RESTAURANT');
    const rows = await this.prisma.kioskDevice.findMany({
      where: { organizationId: auth.membership.organizationId, establishmentId },
      orderBy: { name: 'asc' },
      select: DEVICE_SELECT,
    });
    return rows.map(toDevice);
  }

  async create(auth: TenantContext, establishmentId: string, name: string) {
    await findSellingEstablishment(this.prisma, auth, establishmentId, 'RESTAURANT');
    const pairing = this.newPairingCode();
    try {
      const device = await this.prisma.kioskDevice.create({
        data: {
          organizationId: auth.membership.organizationId,
          establishmentId,
          name,
          pairingCodeHash: hashToken(pairing.code),
          pairingCodeExpiresAt: pairing.expiresAt,
          createdById: auth.membership.id,
        },
        select: DEVICE_SELECT,
      });
      await this.record(auth, 'kiosk.created', device.id, { name });
      return { device: toDevice(device), pairingCode: pairing.code };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'NAME_TAKEN',
          message: 'Une borne porte déjà ce nom.',
        });
      }
      throw error;
    }
  }

  /**
   * Nouveau code d'appairage (remplacement de tablette, réactivation). Le jeton actuel reste valide
   * jusqu'à l'appairage effectif, qui le remplace.
   */
  async newPairing(auth: TenantContext, id: string) {
    await this.find(auth, id);
    const pairing = this.newPairingCode();
    const device = await this.prisma.kioskDevice.update({
      where: { id },
      data: {
        pairingCodeHash: hashToken(pairing.code),
        pairingCodeExpiresAt: pairing.expiresAt,
        isActive: true,
        revokedAt: null,
      },
      select: DEVICE_SELECT,
    });
    await this.record(auth, 'kiosk.pairing_code_issued', id, {});
    return { device: toDevice(device), pairingCode: pairing.code };
  }

  /** Révocation immédiate : le jeton et le code sont effacés ; la borne ne peut plus rien faire. */
  async revoke(auth: TenantContext, id: string) {
    await this.find(auth, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.kioskDevice.update({
        where: { id },
        data: {
          isActive: false,
          revokedAt: new Date(),
          tokenHash: null,
          tokenExpiresAt: null,
          pairingCodeHash: null,
          pairingCodeExpiresAt: null,
        },
      });
      await tx.kioskSession.updateMany({
        where: { deviceId: id, endedAt: null },
        data: { endedAt: new Date() },
      });
      await this.audit.record(
        {
          organizationId: auth.membership.organizationId,
          actorUserId: auth.user.id,
          action: 'kiosk.revoked',
          targetType: 'KioskDevice',
          targetId: id,
        },
        tx,
      );
    });
    return { id, status: 'REVOKED' as const };
  }

  // ─── Appareil ───

  /** Appairage : code valide et non expiré → jeton d'appareil (renvoyé une seule fois). */
  async pair(code: string): Promise<{ token: string; expiresAt: Date; device: KioskContext }> {
    const device = await this.prisma.kioskDevice.findUnique({
      where: { pairingCodeHash: hashToken(code) },
      select: { id: true, organizationId: true, pairingCodeExpiresAt: true },
    });
    if (!device || !device.pairingCodeExpiresAt || device.pairingCodeExpiresAt <= new Date()) {
      throw new UnauthorizedException({
        code: 'INVALID_PAIRING_CODE',
        message: 'Code d’appairage invalide ou expiré.',
      });
    }
    const token = generateToken();
    const expiresAt = new Date(Date.now() + KIOSK_TOKEN_TTL_DAYS * 86_400_000);
    // Usage unique : la mise à jour conditionnelle échoue si le code a déjà servi entre-temps.
    const claimed = await this.prisma.kioskDevice.updateMany({
      where: { id: device.id, pairingCodeHash: hashToken(code) },
      data: {
        tokenHash: hashToken(token),
        tokenExpiresAt: expiresAt,
        pairedAt: new Date(),
        lastSeenAt: new Date(),
        pairingCodeHash: null,
        pairingCodeExpiresAt: null,
        isActive: true,
        revokedAt: null,
      },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException({
        code: 'INVALID_PAIRING_CODE',
        message: 'Code d’appairage invalide ou expiré.',
      });
    }
    await this.audit.record({
      organizationId: device.organizationId,
      actorUserId: null,
      action: 'kiosk.paired',
      targetType: 'KioskDevice',
      targetId: device.id,
    });
    const context = await this.resolve(token);
    if (!context) throw new UnauthorizedException(UNPAIRED);
    return { token, expiresAt, device: context };
  }

  /**
   * Jeton → borne. Refusé si la borne est révoquée ou désactivée, si le jeton a expiré, si
   * l'établissement n'est plus actif ou n'exerce plus l'activité restaurant, ou si l'organisation
   * n'est plus active.
   */
  async resolve(token: string): Promise<KioskContext | null> {
    if (!token) return null;
    const device = await this.prisma.kioskDevice.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        name: true,
        isActive: true,
        revokedAt: true,
        tokenExpiresAt: true,
        lastSeenAt: true,
        organizationId: true,
        establishment: {
          select: {
            id: true,
            name: true,
            isActive: true,
            businessType: true,
            organization: { select: { status: true, businessType: true } },
          },
        },
      },
    });
    if (!device || !device.isActive || device.revokedAt) return null;
    if (!device.tokenExpiresAt || device.tokenExpiresAt <= new Date()) return null;
    const e = device.establishment;
    if (
      !e.isActive ||
      !coversActivity(e.businessType, 'RESTAURANT') ||
      e.organization.status !== 'ACTIVE' ||
      !coversActivity(e.organization.businessType, 'RESTAURANT')
    ) {
      return null;
    }
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.kioskDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
    }
    return {
      deviceId: device.id,
      deviceName: device.name,
      organizationId: device.organizationId,
      establishmentId: e.id,
      establishmentName: e.name,
    };
  }

  /** Nouvelle session client ; les sessions restées ouvertes sur la borne sont closes. */
  async startSession(kiosk: KioskContext) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.kioskSession.updateMany({
        where: { deviceId: kiosk.deviceId, endedAt: null },
        data: { endedAt: now },
      });
      return tx.kioskSession.create({
        data: {
          deviceId: kiosk.deviceId,
          expiresAt: new Date(now.getTime() + KIOSK_SESSION_MINUTES * 60_000),
        },
        select: { id: true, expiresAt: true },
      });
    });
  }

  /** Fin de session (abandon, retour à l'accueil) : la session ne peut plus commander. */
  async endSession(kiosk: KioskContext, sessionId: string) {
    await this.prisma.kioskSession.updateMany({
      where: { id: sessionId, deviceId: kiosk.deviceId, endedAt: null },
      data: { endedAt: new Date() },
    });
  }

  private newPairingCode() {
    let code = '';
    for (let i = 0; i < KIOSK_PAIRING_CODE_LENGTH; i++) {
      code += KIOSK_PAIRING_ALPHABET[randomInt(KIOSK_PAIRING_ALPHABET.length)];
    }
    return { code, expiresAt: new Date(Date.now() + KIOSK_PAIRING_TTL_MINUTES * 60_000) };
  }

  private async find(auth: TenantContext, id: string) {
    const device = await this.prisma.kioskDevice.findFirst({
      where: { id, organizationId: auth.membership.organizationId },
      select: { id: true, establishmentId: true },
    });
    if (!device) throw new NotFoundException(NOT_FOUND);
    await findSellingEstablishment(this.prisma, auth, device.establishmentId, 'RESTAURANT');
    return device;
  }

  private record(
    auth: TenantContext,
    action: string,
    targetId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    return this.audit.record({
      organizationId: auth.membership.organizationId,
      actorUserId: auth.user.id,
      action,
      targetType: 'KioskDevice',
      targetId,
      metadata,
    });
  }
}

export { UNPAIRED };
