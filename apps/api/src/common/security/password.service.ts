import { BadRequestException, Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { passwordPolicyErrors } from '@ocall/shared';

/** Hachage Argon2id (paramètres OWASP : 19 Mio, 2 itérations). */
@Injectable()
export class PasswordService {
  private readonly options = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
  /** Hash factice pour garder un temps de réponse constant quand l'identifiant est inconnu. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }

  assertPolicy(password: string): void {
    const errors = passwordPolicyErrors(password);
    if (errors.length > 0) {
      throw new BadRequestException({
        code: 'WEAK_PASSWORD',
        message: 'Mot de passe trop faible.',
        details: errors,
      });
    }
  }
}
