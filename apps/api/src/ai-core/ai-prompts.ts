/**
 * Gestion des prompts d'Ocall AI Core : chaque consigne envoyée au modèle est un objet versionné,
 * déclaré dans le code de l'application qui l'utilise (revue de code = revue du prompt). Toute
 * modification du texte exige un nouveau numéro de version ; la version utilisée est enregistrée
 * avec chaque appel, pour expliquer a posteriori une réponse.
 */
export interface AiPrompt {
  /** Identifiant stable, préfixé par l'application : `park.copilot`, `school.teaching`… */
  id: string;
  /** Entier croissant, à incrémenter à chaque changement du texte. */
  version: number;
  /** Consignes système du modèle. */
  instructions: string;
}

export interface AiPromptRef {
  id: string;
  version: number;
}

const registry = new Map<string, AiPrompt>();

/**
 * Déclare un prompt. Refuse deux textes différents pour la même version (oubli d'incrémentation),
 * un identifiant sans préfixe d'application et une version non entière.
 */
export function defineAiPrompt(prompt: AiPrompt): AiPrompt {
  if (!/^[a-z][a-z0-9-]*\.[a-z0-9_.-]+$/.test(prompt.id)) {
    throw new Error(`Identifiant de prompt invalide : ${prompt.id} (attendu : application.nom).`);
  }
  if (!Number.isInteger(prompt.version) || prompt.version < 1) {
    throw new Error(`Version de prompt invalide pour ${prompt.id}.`);
  }
  const key = `${prompt.id}@${prompt.version}`;
  const known = registry.get(key);
  if (known && known.instructions !== prompt.instructions) {
    throw new Error(`Le prompt ${key} a changé sans nouvelle version : incrémentez la version.`);
  }
  const frozen = Object.freeze({ ...prompt });
  registry.set(key, frozen);
  return frozen;
}

export function promptRef(prompt: AiPrompt): AiPromptRef {
  return { id: prompt.id, version: prompt.version };
}

/** Prompts déclarés (documentation, contrôle en test). */
export function declaredPrompts(): AiPromptRef[] {
  return [...registry.values()].map(promptRef).sort((a, b) => a.id.localeCompare(b.id));
}
