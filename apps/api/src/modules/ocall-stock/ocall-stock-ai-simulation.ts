import type { AiSimulation } from '../../ai-core/providers/simulated.provider';

/**
 * Scénarios de simulation de l'IA d'Ocall Stock (S8), inscrits auprès du fournisseur simulé d'Ocall AI
 * Core (développement et tests ; le simulé est refusé en production). Ils ne prétendent à aucune qualité :
 * ils éprouvent les règles du serveur (quantités et chiffres du serveur seulement, références connues,
 * code-barres contrôlé, validation humaine). Les réponses malveillantes se testent avec `OCALL-SIM:`.
 */
export const STOCK_AI_SIMULATION: AiSimulation = {
  structureText(request) {
    if (request.schemaName === 'stock_ai_restock') {
      return {
        summary: 'Commande proposée selon les sorties réelles et le délai du fournisseur.',
        lines: [...request.text.matchAll(/^(r\d+) \|/gm)].map(([, ref], i) => ({
          ref: ref!,
          priority: i === 0 ? 'HIGH' : 'MEDIUM',
          reason: 'Sorties régulières et disponible faible au regard du délai fournisseur.',
        })),
      };
    }
    if (request.schemaName === 'stock_ai_stockout') {
      return {
        summary: 'Quelques articles risquent de manquer avant un réapprovisionnement.',
        items: [...request.text.matchAll(/^(s\d+) \|/gm)].map(([, ref]) => ({
          ref: ref!,
          explanation:
            'Risque de rupture : le rythme récent des sorties est élevé au regard du disponible et du délai fournisseur.',
        })),
      };
    }
    if (request.schemaName === 'stock_ai_analysis') {
      return {
        summary:
          'Activité régulière sur la période ; quelques articles portent l’essentiel des ventes.',
        trends: ['Les ventes se concentrent sur un petit nombre d’articles.'],
        strengths: ['Les articles les plus vendus sont disponibles.'],
        weaknesses: ['Certains articles en stock se vendent peu.'],
        suggestions: ['Envisager de mettre en avant les articles peu vendus.'],
      };
    }
    return undefined;
  },
  extractFromDocument(request) {
    if (request.schemaName !== 'stock_ai_product_photo') return undefined;
    const category = /^(c\d+) \|/m.exec(request.prompt)?.[1] ?? '';
    return {
      readable: true,
      name: 'Peinture glycéro brillante',
      brand: 'Seigneurie',
      size: '1 L',
      categoryRef: category,
      barcode: '4006381333931',
    };
  },
};
