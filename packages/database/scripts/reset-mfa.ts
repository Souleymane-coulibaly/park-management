/**
 * `pnpm db:reset-mfa -- --email admin@exemple.com`
 *
 * Procédure serveur de récupération (Sprint 11A) : réinitialise la double authentification d'un
 * compte interne Ocall (téléphone et codes de secours perdus) et ferme toutes ses sessions. Le
 * compte devra se réenrôler à sa prochaine connexion. Réservée à l'équipe ayant accès au serveur ;
 * l'opération est inscrite au journal d'audit.
 */
import { PrismaClient } from '@prisma/client';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  if (!email) throw new Error('Usage : --email <email>');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, platformRole: true },
    });
    if (!user || !user.platformRole) throw new Error(`Aucun compte interne Ocall pour ${email}.`);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          mfaSecret: null,
          mfaPendingSecret: null,
          mfaEnabledAt: null,
          mfaRecoveryCodes: [],
          mfaLastStep: null,
        },
      }),
      prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: null,
          actorUserId: null,
          action: 'platform.user_mfa_reset_server',
          targetType: 'User',
          targetId: user.id,
          metadata: { email, via: 'script' },
        },
      }),
    ]);
    console.log(`Double authentification réinitialisée pour ${email} ; sessions fermées.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
