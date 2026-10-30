/** Erreur matérielle normalisée (code stable + message affichable), quelle que soit la voie d'impression. */
export class HardwareError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
