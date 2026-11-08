import { normalizeLabel } from '@ocall/shared';
import type { AiToolCall } from '../../../ai-core/ai-provider';
import type { AiSimulation } from '../../../ai-core/providers/simulated.provider';
import { SCHOOL_COPILOT_PROMPT } from './school-ai.prompts';

/**
 * Scénarios de simulation d'Ocall School AI, inscrits auprès du fournisseur simulé d'Ocall AI Core
 * (développement et tests ; le simulé est refusé en production). Ils ne prétendent à aucune qualité :
 * ils éprouvent les règles du serveur (outils autorisés, contrôle des chiffres, validation humaine).
 */
export const SCHOOL_AI_SIMULATION: AiSimulation = {
  runWithTools(request) {
    if (!request.instructions.startsWith(SCHOOL_COPILOT_PROMPT.instructions)) return undefined;
    const q = normalizeLabel(request.question);
    if (/\b(modifie|change|supprime|ajoute|corrige|annule|inscris|exclus)\b/.test(q)) {
      return {
        calls: [],
        answer:
          'Je suis en lecture seule : je ne peux modifier ni note, ni inscription, ni paiement, ni aucune donnée.',
      };
    }
    const range = /\bmois\b/.test(q) ? 'this_month' : 'year';
    const calls: AiToolCall[] = [];
    if (/synthese/.test(q)) {
      calls.push(
        { name: 'school_overview', arguments: {} },
        { name: 'results_by_period', arguments: { class_name: '' } },
        { name: 'attendance_summary', arguments: { range } },
      );
    } else if (/compare|comparaison/.test(q)) {
      calls.push({ name: 'compare_periods', arguments: { first: 1, second: 2 } });
    } else if (/impaye|encaiss|frais|paiement/.test(q)) {
      calls.push({ name: 'finance_summary', arguments: { range } });
    } else if (/absence|absent|assiduite|retard/.test(q)) {
      calls.push({ name: 'attendance_summary', arguments: { range } });
    } else if (/resultat|moyenne|reussite/.test(q)) {
      calls.push({ name: 'results_by_period', arguments: { class_name: '' } });
    } else if (/inscrit|effectif|eleve|classe|enseignant/.test(q)) {
      calls.push({ name: 'school_overview', arguments: {} });
    }
    if (calls.length === 0) {
      return {
        calls,
        answer: 'Pouvez-vous préciser votre question (indicateur, période) ?',
      };
    }
    return { calls, answer: 'Voici les chiffres calculés sur les rapports de l’établissement.' };
  },

  structureText(request) {
    if (request.schemaName === 'school_teaching_content') {
      const keys = (request.text.match(/SECTIONS \(clés, dans l’ordre\) : (.*)/)?.[1] ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      const topic =
        request.text.match(/SUJET \(donnée saisie par l’enseignant\) : (.*)/)?.[1] ?? '';
      const arabic = /LANGUE : arabe/.test(request.text);
      return {
        title: arabic ? `درس: ${topic}` : `Contenu : ${topic}`,
        sections: keys.map((key) => ({
          key,
          heading: key,
          body: arabic
            ? `محتوى مقترح لقسم ${key}.`
            : `Contenu proposé pour la section « ${key} » sur ${topic}.`,
        })),
      };
    }
    if (request.schemaName === 'school_teaching_section') {
      return {
        heading: 'Section révisée',
        body: 'Version révisée de la section, à relire par l’enseignant.',
      };
    }
    if (request.schemaName === 'school_analysis_summary') {
      return {
        summary:
          'Synthèse des indicateurs calculés par le serveur : consultez l’évolution par classe et par matière ci-dessous.',
        highlights: ['Les tendances sont calculées sur les périodes renseignées.'],
        supportSuggestions: ['Envisager un soutien collectif dans les matières en baisse.'],
        limits: ['Indicateurs agrégés par classe et matière, sans élève désigné.'],
      };
    }
    return undefined;
  },
};
