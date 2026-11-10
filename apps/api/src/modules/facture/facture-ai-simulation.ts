import { normalizeLabel } from '@ocall/shared';
import type { AiSimulation } from '../../ai-core/providers/simulated.provider';

/**
 * Scénarios de simulation du module IA d'Ocall Facture, inscrits auprès du fournisseur simulé d'Ocall
 * AI Core (développement et tests ; le simulé est refusé en production). Ils ne prétendent à aucune
 * qualité : ils éprouvent les règles du serveur (catalogue seul, aucun prix, chiffres contrôlés,
 * validation humaine). Les réponses malveillantes se testent avec le marqueur `OCALL-SIM:`.
 */
export const FACTURE_AI_SIMULATION: AiSimulation = {
  structureText(request) {
    if (request.schemaName === 'facture_ai_report') {
      const observations = (request.text.split('OBSERVATIONS DU TECHNICIEN')[1] ?? '')
        .replace(/^[^:]*:/, '')
        .replace(/\d+/g, '')
        .trim();
      return {
        findings: observations
          ? `Constat du technicien : ${observations}`
          : 'Constat : équipement examiné sur place.',
        workDone:
          'Travaux réalisés conformément à la demande ; fonctionnement contrôlé en fin d’intervention.',
        recommendations:
          'Entretien périodique recommandé ; état général à vérifier lors de la prochaine visite.',
      };
    }
    if (request.schemaName === 'facture_ai_quote') {
      const demand = normalizeLabel(request.text.split('DEMANDE DU CLIENT')[1] ?? '');
      const lines = [...request.text.matchAll(/^(i\d+) \| ([^|]+) \|/gm)]
        .filter(([, , name]) =>
          normalizeLabel(name!)
            .split(/\s+/)
            .some((word) => word.length > 3 && demand.includes(word)),
        )
        .map(([, ref]) => ({ ref: ref!, quantity: 1, note: '' }));
      return {
        subject: 'Devis selon votre demande',
        lines,
        missing:
          lines.length === 0
            ? ['Aucun article du catalogue ne correspond à la demande : préciser le besoin.']
            : ['Quantités à confirmer avec le client.'],
      };
    }
    return undefined;
  },
};
