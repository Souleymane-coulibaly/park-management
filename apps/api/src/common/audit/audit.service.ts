import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ocall/database';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  /** null pour une action de plateforme (Super Admin) ou un échec de connexion anonyme. */
  organizationId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

type Db = Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient;

/** Journal d'audit en ajout seul. Ne jamais y écrire de mot de passe ni de jeton. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}
