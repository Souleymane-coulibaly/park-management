import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/database';
import {
  SCHOOL_PRODUCT_CODE,
  type AuthProductApp,
  type SuiteContractStatus,
  activitiesOf,
  type ResolvedProductEntitlement,
  resolveProductEntitlement,
  canTransitionContract,
  isValidDateRange,
} from '@ocall/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext, TenantContext } from '../../common/auth-context';
import { PasswordService } from '../../common/security/password.service';
import { generateTemporaryPassword } from '../../common/security/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import type {
  ContractTermsDto,
  ContractTransitionDto,
  CreateContractClientDto,
  CreateContractDto,
  RenewContractDto,
  UpdateContractScopeDto,
} from './suite-contracts.dto';

const SELECT = {
  id: true,
  organizationId: true,
  reference: true,
  status: true,
  startsOn: true,
  endsOn: true,
  modules: true,
  limits: true,
  coveredSchoolIds: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { name: true } },
  product: { select: { code: true, name: true } },
} as const;

const NOT_FOUND = { code: 'CONTRACT_NOT_FOUND', message: 'Contrat introuvable.' };

/**
 * Droits d'un client sur un produit, résolus sur TOUS ses contrats (voir resolveProductEntitlement) :
 * accès le plus large, périmètres de lecture et d'écriture par établissement (null = tous),
 * union des modules, limite d'établissements la plus favorable.
 */
export type ProductEntitlement = ResolvedProductEntitlement;

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * Contrats B2B Ocall Suite. Aucun tarif ici, et aucune opération ne supprime de contrat ni de données :
 * suspendre, expirer ou résilier ne fait que réduire l'accès au produit à la lecture seule.
 */
@Injectable()
export class SuiteContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly provisioning: OrganizationProvisioningService,
  ) {}

  /** Droit d'accès d'un client à un produit, recalculé à chaque requête. */
  async entitlement(organizationId: string, productCode: string): Promise<ProductEntitlement> {
    const contracts = await this.prisma.suiteContract.findMany({
      where: { organizationId, product: { code: productCode } },
      select: {
        status: true,
        startsOn: true,
        endsOn: true,
        modules: true,
        limits: true,
        coveredSchoolIds: true,
      },
    });
    // Tous les contrats valides comptent, jamais un seul retenu selon l'ordre de la base.
    return resolveProductEntitlement(
      contracts.map((c) => ({
        ...c,
        limits: (c.limits ?? {}) as { maxSchools?: number },
      })),
    );
  }

  /**
   * Contrats d'un client pour un produit qui couvrent un établissement (couverture vide = tous), avec
   * la date EFFECTIVE de passage en lecture seule : la plus ancienne entre le dernier changement vers le
   * statut actuel et le lendemain de l'échéance déjà dépassée (une expiration administrative tardive ne
   * redémarre pas le maintien). Sert au maintien temporaire des sites publiés (Sprint 10 School).
   */
  async contractWindows(
    organizationId: string,
    productCode: string,
    schoolId: string,
  ): Promise<
    { status: SuiteContractStatus; startsOn: Date; endsOn: Date; readOnlySince: Date | null }[]
  > {
    const contracts = await this.prisma.suiteContract.findMany({
      where: { organizationId, product: { code: productCode } },
      select: {
        status: true,
        startsOn: true,
        endsOn: true,
        updatedAt: true,
        coveredSchoolIds: true,
        events: {
          where: { toStatus: { in: ['SUSPENDED', 'EXPIRED', 'TERMINATED'] } },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { toStatus: true, createdAt: true },
        },
      },
    });
    const DAY_MS = 86_400_000;
    return contracts
      .filter((c) => c.coveredSchoolIds.length === 0 || c.coveredSchoolIds.includes(schoolId))
      .map((c) => {
        let readOnlySince: Date | null = null;
        if (c.status !== 'ACTIVE' && c.status !== 'DRAFT') {
          const changed = c.events.find((e) => e.toStatus === c.status)?.createdAt ?? c.updatedAt;
          const afterEnd = new Date(c.endsOn.getTime() + DAY_MS);
          readOnlySince = afterEnd < changed ? afterEnd : changed;
        }
        return { status: c.status, startsOn: c.startsOn, endsOn: c.endsOn, readOnlySince };
      });
  }

  /** Applications du portail Ocall Suite accessibles à ce membre, décidées par le serveur. */
  async apps(auth: TenantContext, schoolEnabled: boolean): Promise<AuthProductApp[]> {
    const apps: AuthProductApp[] = [];
    if (
      activitiesOf(auth.membership.businessType).length > 0 &&
      auth.membership.role !== 'PRODUCT_USER'
    ) {
      apps.push({ code: 'OCALL_PARK', name: 'Ocall Park', href: '/app', access: 'full' });
    }
    if (schoolEnabled) {
      const school = await this.entitlement(auth.membership.organizationId, SCHOOL_PRODUCT_CODE);
      if (school.access !== 'none') {
        apps.push({
          code: SCHOOL_PRODUCT_CODE,
          name: 'Ocall School',
          href: '/school',
          access: school.access,
        });
      }
    }
    return apps;
  }

  async list() {
    return this.prisma.suiteContract.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: SELECT,
    });
  }

  async get(id: string) {
    const contract = await this.prisma.suiteContract.findUnique({
      where: { id },
      select: {
        ...SELECT,
        events: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            type: true,
            fromStatus: true,
            toStatus: true,
            fromEndsOn: true,
            toEndsOn: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });
    if (!contract) throw new NotFoundException(NOT_FOUND);
    return contract;
  }

  async create(auth: AuthContext, dto: CreateContractDto) {
    this.assertDates(dto.startsOn, dto.endsOn);
    const id = await this.uniqueReference(() =>
      this.prisma.$transaction(async (tx) => {
        const org = await tx.organization.findUnique({
          where: { id: dto.organizationId },
          select: { id: true },
        });
        if (!org) {
          throw new NotFoundException({
            code: 'ORGANIZATION_NOT_FOUND',
            message: 'Organisation introuvable.',
          });
        }
        return this.insert(tx, auth, dto.organizationId, dto);
      }),
    );
    return this.get(id);
  }

  /** Nouveau client sur contrat : organisation sans activité Park, propriétaire, contrat en brouillon. */
  async createClient(auth: AuthContext, dto: CreateContractClientDto) {
    this.assertDates(dto.startsOn, dto.endsOn);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const { id, loginId } = await this.uniqueReference(() =>
      this.prisma.$transaction(async (tx) => {
        const client = await this.provisioning.provisionContractClient(tx, {
          organizationName: dto.organizationName,
          countryCode: dto.countryCode,
          owner: {
            firstName: dto.ownerFirstName,
            lastName: dto.ownerLastName,
            email: dto.ownerEmail,
            passwordHash,
          },
        });
        const contractId = await this.insert(tx, auth, client.organizationId, dto);
        return { id: contractId, loginId: client.loginId };
      }),
    );
    return { contract: await this.get(id), loginId, temporaryPassword };
  }

  async transition(auth: AuthContext, id: string, dto: ContractTransitionDto) {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.find(tx, id);
      if (!canTransitionContract(current.status, dto.status)) {
        throw new ConflictException({
          code: 'CONTRACT_TRANSITION_REFUSED',
          message: 'Ce changement de statut n’est pas autorisé.',
        });
      }
      // Transition conditionnelle : deux décisions simultanées ne s'appliquent pas deux fois.
      const { count } = await tx.suiteContract.updateMany({
        where: { id, status: current.status },
        data: { status: dto.status },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'CONTRACT_CHANGED',
          message: 'Le contrat vient de changer : rechargez la page.',
        });
      }
      await this.event(tx, auth, id, current.organizationId, 'STATUS_CHANGED', {
        fromStatus: current.status,
        toStatus: dto.status,
        reason: dto.reason,
      });
    });
    return this.get(id);
  }

  /** Renouvellement : prolonge le contrat, et le réactive s'il avait expiré. */
  async renew(auth: AuthContext, id: string, dto: RenewContractDto) {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.find(tx, id);
      if (current.status !== 'ACTIVE' && current.status !== 'EXPIRED') {
        throw new ConflictException({
          code: 'CONTRACT_NOT_RENEWABLE',
          message: 'Seul un contrat actif ou expiré peut être renouvelé.',
        });
      }
      const endsOn = toDate(dto.endsOn);
      if (endsOn.getTime() <= current.endsOn.getTime()) {
        throw new BadRequestException({
          code: 'INVALID_CONTRACT_DATES',
          message: 'La nouvelle échéance doit suivre l’échéance actuelle.',
        });
      }
      await tx.suiteContract.update({ where: { id }, data: { endsOn, status: 'ACTIVE' } });
      await this.event(tx, auth, id, current.organizationId, 'RENEWED', {
        fromStatus: current.status,
        toStatus: 'ACTIVE',
        fromEndsOn: current.endsOn,
        toEndsOn: endsOn,
        reason: dto.reason,
      });
    });
    return this.get(id);
  }

  async updateScope(auth: AuthContext, id: string, dto: UpdateContractScopeDto) {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.find(tx, id);
      await tx.suiteContract.update({
        where: { id },
        data: {
          modules: dto.modules,
          coveredSchoolIds: dto.coveredSchoolIds,
          limits: dto.limits ? ({ ...dto.limits } as Prisma.InputJsonObject) : undefined,
        },
      });
      // Une liste vide signifie « tous les établissements » : la valeur exacte reste dans le motif.
      await this.event(tx, auth, id, current.organizationId, 'SCOPE_CHANGED', {
        reason: JSON.stringify({
          fields: Object.keys(dto),
          fromModules: current.modules,
          toModules: dto.modules ?? current.modules,
          fromSchoolIds: current.coveredSchoolIds,
          toSchoolIds: dto.coveredSchoolIds ?? current.coveredSchoolIds,
        }),
      });
    });
    return this.get(id);
  }

  private assertDates(startsOn: string, endsOn: string) {
    if (!isValidDateRange(startsOn, endsOn)) {
      throw new BadRequestException({
        code: 'INVALID_CONTRACT_DATES',
        message: 'La fin du contrat doit suivre son début.',
      });
    }
  }

  /** Verrouille le contrat : deux changements simultanés se sérialisent, le second relit l'état validé. */
  private async find(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM "SuiteContract" WHERE id = ${id}::uuid FOR UPDATE`;
    const contract = await tx.suiteContract.findUnique({
      where: { id },
      select: {
        status: true,
        organizationId: true,
        endsOn: true,
        modules: true,
        coveredSchoolIds: true,
      },
    });
    if (!contract) throw new NotFoundException(NOT_FOUND);
    return contract;
  }

  private async insert(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    organizationId: string,
    terms: ContractTermsDto,
  ): Promise<string> {
    const product = await tx.saasProduct.findUniqueOrThrow({
      where: { code: SCHOOL_PRODUCT_CODE },
      select: { id: true },
    });
    const contract = await tx.suiteContract.create({
      data: {
        organizationId,
        productId: product.id,
        reference: terms.reference,
        startsOn: toDate(terms.startsOn),
        endsOn: toDate(terms.endsOn),
        modules: terms.modules ?? [],
        limits: (terms.limits ?? {}) as Prisma.InputJsonObject,
        createdById: auth.user.id,
      },
      select: { id: true },
    });
    await this.event(tx, auth, contract.id, organizationId, 'CREATED', { toStatus: 'DRAFT' });
    return contract.id;
  }

  private async event(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    contractId: string,
    organizationId: string,
    type: 'CREATED' | 'STATUS_CHANGED' | 'RENEWED' | 'SCOPE_CHANGED',
    details: {
      fromStatus?: SuiteContractStatus;
      toStatus?: SuiteContractStatus;
      fromEndsOn?: Date;
      toEndsOn?: Date;
      reason?: string;
    },
  ) {
    await tx.suiteContractEvent.create({
      data: { contractId, type, actorUserId: auth.user.id, ...details },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: auth.user.id,
        action: `platform.contract_${type.toLowerCase()}`,
        targetType: 'SuiteContract',
        targetId: contractId,
        metadata: {
          fromStatus: details.fromStatus ?? null,
          toStatus: details.toStatus ?? null,
          reason: details.reason ?? null,
        },
      },
      tx,
    );
  }

  private async uniqueReference<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target ?? '');
        throw new ConflictException(
          target.includes('email')
            ? { code: 'EMAIL_ALREADY_USED', message: 'Cet e-mail est déjà utilisé.' }
            : { code: 'CONTRACT_REFERENCE_USED', message: 'Cette référence existe déjà.' },
        );
      }
      throw error;
    }
  }
}
