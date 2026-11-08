/**
 * Manifeste des prompts d'Ocall AI Core : empreinte (SHA-256, 16 premiers caractères) du texte de chaque
 * version déclarée. Versionné avec le code : le test `ai-prompt-manifest.spec.ts` échoue si un texte
 * change sans nouvelle version (même d'un démarrage à l'autre), ou si une version n'est pas inscrite ici.
 * Changer un prompt = incrémenter sa version ET ajouter sa nouvelle empreinte, sans retirer l'ancienne.
 */
export const AI_PROMPT_MANIFEST: Readonly<Record<string, string>> = {
  'park.copilot@1': 'ecea24f368b4b32b',
  'park.import@1': '4b21493dee5c926a',
  'park.voice_order@1': 'c41848094d578384',
  'school.copilot@1': '70d5b495d61f868d',
  'school.teaching@1': '9a5494341ed692fd',
  'school.teaching_section@1': 'db9af55cb942438e',
  'school.analysis@1': 'c1880adc54e3d5d1',
};
