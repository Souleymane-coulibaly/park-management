import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import {
  EMPTY_OCALL_LEGAL_IDENTITY,
  OCALL_LEGAL_FIELDS,
  type OcallLegalField,
  type OcallLegalIdentity,
  cleanLegalValue,
  missingInvoiceLegalFields,
  publicLegalIdentity,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';

type Db = Pick<Prisma.TransactionClient, 'platformLegalIdentity'>;

/** Ligne unique de l'identité Ocall. */
const IDENTITY_ID = 'ocall';

const SELECT = Object.fromEntries(OCALL_LEGAL_FIELDS.map((f) => [f, true])) as Record<
  OcallLegalField,
  true
>;

/**
 * Identité légale de l'éditeur Ocall (commercialisation J2) : saisie par le propriétaire ou un
 * administrateur de la plateforme, jamais inventée. Source unique des pages légales et des factures et
 * reçus d'abonnement Ocall ; sans rapport avec l'identité d'une organisation cliente.
 */
@Injectable()
export class LegalIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async current(db: Db = this.prisma): Promise<OcallLegalIdentity> {
    const row = await db.platformLegalIdentity.findUnique({
      where: { id: IDENTITY_ID },
      select: SELECT,
    });
    return row ? { ...EMPTY_OCALL_LEGAL_IDENTITY, ...row } : { ...EMPTY_OCALL_LEGAL_IDENTITY };
  }

  /** Vue de l'administration : identité et mentions manquantes pour une facture définitive. */
  async view() {
    const row = await this.prisma.platformLegalIdentity.findUnique({
      where: { id: IDENTITY_ID },
      select: { ...SELECT, updatedAt: true },
    });
    const { updatedAt = null, ...fields } = row ?? {};
    const identity: OcallLegalIdentity = { ...EMPTY_OCALL_LEGAL_IDENTITY, ...fields };
    const missing = missingInvoiceLegalFields(identity);
    return {
      identity,
      missingForInvoices: missing,
      invoicesDefinitive: missing.length === 0,
      updatedAt,
    };
  }

  /** Pages légales publiques : sans les coordonnées bancaires. */
  async publicView() {
    return publicLegalIdentity(await this.current());
  }

  /**
   * Mise à jour : seuls les champs transmis changent (chaîne vide = effacer). Journalisée avec la liste
   * des champs modifiés, sans leurs valeurs. Les factures déjà émises ne changent jamais : elles portent
   * leur propre copie.
   */
  async update(auth: AuthContext, input: Partial<Record<OcallLegalField, string | null>>) {
    const before = await this.current();
    const data: Partial<Record<OcallLegalField, string | null>> = {};
    for (const field of OCALL_LEGAL_FIELDS) {
      if (!(field in input)) continue;
      const value = cleanLegalValue(input[field]);
      if (value !== before[field]) data[field] = value;
    }
    const changed = Object.keys(data) as OcallLegalField[];
    if (changed.length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.platformLegalIdentity.upsert({
          where: { id: IDENTITY_ID },
          create: { id: IDENTITY_ID, ...data, updatedById: auth.user.id },
          update: { ...data, updatedById: auth.user.id },
        });
        await this.audit.record(
          {
            organizationId: null,
            actorUserId: auth.user.id,
            action: 'platform.legal_identity_updated',
            targetType: 'PlatformLegalIdentity',
            targetId: null,
            metadata: { fields: changed },
          },
          tx,
        );
      });
    }
    return this.view();
  }

  /**
   * Identité à figer sur une facture émise : complète (toutes les mentions obligatoires) ou null
   * (facture provisoire). Lue dans la transaction d'émission.
   */
  async invoiceSnapshot(db: Db): Promise<OcallLegalIdentity | null> {
    const identity = await this.current(db);
    return missingInvoiceLegalFields(identity).length === 0 ? identity : null;
  }
}
