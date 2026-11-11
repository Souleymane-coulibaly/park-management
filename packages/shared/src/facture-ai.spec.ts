import { hasFacturePermission } from './facture';
import { factureAiTextEdited } from './facture-ai';

describe('Ocall Facture — module IA (F6A)', () => {
  it('droits : rapport pour le technicien, devis pour le commercial, ni l’un ni l’autre au comptable', () => {
    expect(hasFacturePermission('TECHNICIAN', 'facture.ai.report')).toBe(true);
    expect(hasFacturePermission('TECHNICIAN', 'facture.ai.quote')).toBe(false);
    expect(hasFacturePermission('SALES', 'facture.ai.quote')).toBe(true);
    expect(hasFacturePermission('SALES', 'facture.ai.report')).toBe(false);
    expect(hasFacturePermission('ACCOUNTANT', 'facture.ai.report')).toBe(false);
    expect(hasFacturePermission('ACCOUNTANT', 'facture.ai.quote')).toBe(false);
    expect(hasFacturePermission('MANAGER', 'facture.ai.quote')).toBe(true);
  });

  it('texte corrigé : les espaces superflus ne comptent pas', () => {
    expect(factureAiTextEdited('Filtres  nettoyés.\n', 'Filtres nettoyés.')).toBe(false);
    expect(factureAiTextEdited('Filtres nettoyés.', 'Filtres remplacés.')).toBe(true);
    expect(factureAiTextEdited(null, '')).toBe(false);
  });
});
