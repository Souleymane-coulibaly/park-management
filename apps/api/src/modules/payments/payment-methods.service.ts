import { ConflictException, Injectable } from '@nestjs/common';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@ocall/shared';
import type { PaymentProvider } from './payment-provider';

export interface PaymentMethodAvailability {
  method: PaymentMethod;
  label: string;
  available: boolean;
  /** Explication affichée lorsque le moyen n'est pas disponible. */
  reason: string | null;
}

/**
 * Registre des moyens de paiement. Les espèces sont toujours disponibles ; un moyen électronique
 * ne l'est que si un `PaymentProvider` est réellement enregistré. Aucun ne l'est aujourd'hui :
 * Wave est annoncé comme « non activé », sans jamais simuler de paiement.
 */
@Injectable()
export class PaymentMethodsService {
  private readonly providers = new Map<PaymentMethod, PaymentProvider>();

  list(): PaymentMethodAvailability[] {
    return PAYMENT_METHODS.map((method) => {
      const available = method === 'CASH' || this.providers.has(method);
      return {
        method,
        label: PAYMENT_METHOD_LABELS[method],
        available,
        reason: available ? null : `${PAYMENT_METHOD_LABELS[method]} n'est pas encore activé.`,
      };
    });
  }

  /** Refuse explicitement un moyen de paiement électronique non branché. */
  assertAvailable(method: PaymentMethod): void {
    if (method === 'CASH' || this.providers.has(method)) return;
    throw new ConflictException({
      code: 'PAYMENT_METHOD_UNAVAILABLE',
      message: `Le paiement ${PAYMENT_METHOD_LABELS[method]} n'est pas encore activé. Encaissez en espèces.`,
    });
  }
}
