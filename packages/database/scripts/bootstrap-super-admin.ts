/**
 * `pnpm db:bootstrap-super-admin -- --email admin@exemple.com --first-name Awa --last-name Traoré`
 *
 * Crée le compte SUPER_ADMIN avec un mot de passe temporaire aléatoire, affiché une seule fois
 * et à changer obligatoirement à la première connexion. Refuse si l'e-mail existe déjà.
 */
import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Mot de passe temporaire conforme à la politique (minuscule, majuscule, chiffre, 16+ caractères). */
function temporaryPassword(): string {
  return `Tmp${randomBytes(12).toString('base64url')}9a`;
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const firstName = arg('first-name')?.trim();
  const lastName = arg('last-name')?.trim();
  if (!email || !firstName || !lastName) {
    throw new Error('Usage : --email <email> --first-name <prénom> --last-name <nom>');
  }

  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email } })) {
      throw new Error(`Un compte existe déjà pour ${email}.`);
    }
    const password = temporaryPassword();
    await prisma.user.create({
      data: {
        email,
        loginId: email,
        firstName,
        lastName,
        platformRole: 'SUPER_ADMIN',
        mustChangePassword: true,
        passwordHash: await hash(password, { type: 2 }),
      },
    });
    console.log(`Super Admin créé : ${email}`);
    console.log(`Mot de passe temporaire (affiché une seule fois) : ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
