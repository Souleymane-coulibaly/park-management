import { hasFacturePermission } from './facture';
import {
  FACTURE_INTERVENTION_STATUSES,
  canMoveFactureIntervention,
  canWorkOnFactureIntervention,
  factureHoursOf,
  factureInterventionScope,
  formatFactureInterventionNumber,
  formatFactureMinutes,
  isFactureInterventionPlanningOpen,
  isFactureInterventionWorkOpen,
} from './facture-interventions';

describe('Ocall Facture — interventions (F3)', () => {
  it('transitions : planifiée → en cours → réalisée → signée → facturée ; rien après', () => {
    expect(canMoveFactureIntervention('PLANNED', 'IN_PROGRESS')).toBe(true);
    expect(canMoveFactureIntervention('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canMoveFactureIntervention('COMPLETED', 'SIGNED')).toBe(true);
    expect(canMoveFactureIntervention('SIGNED', 'INVOICED')).toBe(true);
    // Réouverture avant signature seulement ; annulation avant la fin des travaux seulement.
    expect(canMoveFactureIntervention('COMPLETED', 'IN_PROGRESS')).toBe(true);
    expect(canMoveFactureIntervention('SIGNED', 'IN_PROGRESS')).toBe(false);
    expect(canMoveFactureIntervention('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canMoveFactureIntervention('PLANNED', 'COMPLETED')).toBe(false);
    expect(canMoveFactureIntervention('COMPLETED', 'INVOICED')).toBe(false);
    for (const to of FACTURE_INTERVENTION_STATUSES) {
      expect(canMoveFactureIntervention('INVOICED', to)).toBe(false);
      expect(canMoveFactureIntervention('CANCELLED', to)).toBe(false);
    }
  });

  it('planning modifiable avant la fin des travaux ; temps, pièces et photos pendant les travaux', () => {
    expect(FACTURE_INTERVENTION_STATUSES.filter(isFactureInterventionPlanningOpen)).toEqual([
      'PLANNED',
      'IN_PROGRESS',
    ]);
    expect(FACTURE_INTERVENTION_STATUSES.filter(isFactureInterventionWorkOpen)).toEqual([
      'IN_PROGRESS',
    ]);
  });

  it('durées : affichage et heures facturées à 3 décimales', () => {
    expect(formatFactureMinutes(45)).toBe('45 min');
    expect(formatFactureMinutes(120)).toBe('2 h');
    expect(formatFactureMinutes(95)).toBe('1 h 35');
    expect(formatFactureMinutes(605)).toBe('10 h 05');
    expect(factureHoursOf(90)).toBe(1.5);
    expect(factureHoursOf(100)).toBe(1.667);
    expect(factureHoursOf(1)).toBe(0.017);
  });

  it('référence : INT-année-rang ; rang invalide refusé', () => {
    expect(formatFactureInterventionNumber(2026, 7)).toBe('INT-2026-00007');
    expect(() => formatFactureInterventionNumber(2026, 0)).toThrow();
  });

  it('droits : le technicien voit et réalise ses interventions seulement ; le commercial planifie', () => {
    expect(factureInterventionScope('MANAGER')).toBe('all');
    expect(factureInterventionScope('SALES')).toBe('all');
    expect(factureInterventionScope('ACCOUNTANT')).toBe('all');
    expect(factureInterventionScope('TECHNICIAN')).toBe('assigned');
    expect(canWorkOnFactureIntervention('TECHNICIAN', true)).toBe(true);
    expect(canWorkOnFactureIntervention('TECHNICIAN', false)).toBe(false);
    expect(canWorkOnFactureIntervention('MANAGER', false)).toBe(true);
    expect(canWorkOnFactureIntervention('SALES', true)).toBe(false);
    expect(canWorkOnFactureIntervention('ACCOUNTANT', true)).toBe(false);
    expect(hasFacturePermission('SALES', 'facture.interventions.manage')).toBe(true);
    expect(hasFacturePermission('ACCOUNTANT', 'facture.interventions.manage')).toBe(false);
    expect(hasFacturePermission('TECHNICIAN', 'facture.documents.read')).toBe(false);
  });
});
