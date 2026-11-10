import { createHash } from 'node:crypto';
import { PARK_COPILOT_PROMPT } from '../modules/ai/copilot/copilot.prompt';
import { PARK_IMPORT_PROMPT } from '../modules/ai/imports/import-extraction';
import { PARK_VOICE_PROMPT } from '../modules/ai/voice/voice-order.service';
import {
  SCHOOL_ANALYSIS_PROMPT,
  SCHOOL_COPILOT_PROMPT,
  SCHOOL_TEACHING_PROMPT,
  SCHOOL_TEACHING_SECTION_PROMPT,
} from '../modules/school/ai/school-ai.prompts';
import { FACTURE_QUOTE_PROMPT, FACTURE_REPORT_PROMPT } from '../modules/facture/facture-ai.prompts';
import { AI_PROMPT_MANIFEST } from './ai-prompt-manifest';

/**
 * Versionnement des prompts garanti au-delà d'un processus : chaque version a une empreinte inscrite au
 * manifeste ; un texte modifié sans nouvelle version est refusé par ce test (revue de code).
 */
describe('Manifeste des prompts d’Ocall AI Core', () => {
  const prompts = [
    PARK_COPILOT_PROMPT,
    PARK_IMPORT_PROMPT,
    PARK_VOICE_PROMPT,
    SCHOOL_COPILOT_PROMPT,
    SCHOOL_TEACHING_PROMPT,
    SCHOOL_TEACHING_SECTION_PROMPT,
    SCHOOL_ANALYSIS_PROMPT,
    FACTURE_REPORT_PROMPT,
    FACTURE_QUOTE_PROMPT,
  ];

  it.each(prompts.map((p) => [`${p.id}@${p.version}`, p] as const))(
    '%s : texte conforme à son empreinte',
    (key, prompt) => {
      const hash = createHash('sha256').update(prompt.instructions).digest('hex').slice(0, 16);
      expect({ key, hash }).toEqual({ key, hash: AI_PROMPT_MANIFEST[key] });
    },
  );

  it('chaque version déclarée est inscrite au manifeste', () => {
    for (const p of prompts) expect(AI_PROMPT_MANIFEST[`${p.id}@${p.version}`]).toBeDefined();
  });
});
