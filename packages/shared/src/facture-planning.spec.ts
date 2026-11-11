import {
  factureAiClaimsCertainty,
  factureMaintenanceCandidates,
  facturePlanningCandidates,
  firstFreeSlot,
} from './facture-planning';

const at = (iso: string) => new Date(iso);
const now = at('2026-11-10T07:00:00Z');
const members = [
  { id: 'a', name: 'Awa', skillIds: ['clim', 'elec'] },
  { id: 'b', name: 'Bakary', skillIds: ['clim'] },
  { id: 'c', name: 'Cheick', skillIds: ['plomberie'] },
];

describe('Ocall Facture — planification (F6B)', () => {
  it('créneau demandé conservé si libre ; conflit → premier créneau libre ; compétences d’abord', () => {
    const candidates = facturePlanningCandidates({
      start: at('2026-11-11T08:00:00Z'),
      end: at('2026-11-11T10:00:00Z'),
      priority: 'NORMAL',
      requiredSkillIds: ['clim', 'elec'],
      members,
      busy: [
        {
          memberId: 'a',
          start: at('2026-11-11T09:00:00Z'),
          end: at('2026-11-11T11:00:00Z'),
          label: 'INT-1',
        },
      ],
      now,
    });
    // Cheick n'a aucune compétence requise : écarté. Awa (toutes) est en conflit : décalée à 11:00.
    expect(candidates.map((c) => [c.memberId, c.start.toISOString(), c.requestedSlot])).toEqual([
      ['a', '2026-11-11T11:00:00.000Z', false],
      ['b', '2026-11-11T08:00:00.000Z', true],
    ]);
    expect(candidates[0]!.conflicts).toEqual(['INT-1']);
    expect(candidates[1]).toMatchObject({ skillsMatched: 1, skillsRequired: 2 });
  });

  it('urgence : le plus tôt possible à partir de maintenant, dans les heures de travail', () => {
    const [first] = facturePlanningCandidates({
      start: at('2026-11-14T08:00:00Z'),
      end: at('2026-11-14T09:00:00Z'),
      priority: 'URGENT',
      requiredSkillIds: [],
      members,
      busy: [
        {
          memberId: 'a',
          start: at('2026-11-10T08:00:00Z'),
          end: at('2026-11-10T18:00:00Z'),
          label: 'congé',
        },
      ],
      now,
    });
    expect(first!.start.toISOString()).toBe('2026-11-10T08:00:00.000Z');
    expect(first!.memberId).not.toBe('a');
  });

  it('créneau libre : jamais hors journée de travail ni en chevauchement ; null au-delà de l’horizon', () => {
    const slot = firstFreeSlot(
      [
        {
          memberId: 'a',
          start: at('2026-11-10T08:00:00Z'),
          end: at('2026-11-10T17:00:00Z'),
          label: 'x',
        },
      ],
      at('2026-11-10T07:10:00Z'),
      2 * 3_600_000,
      at('2026-11-20T00:00:00Z'),
    );
    expect(slot!.start.toISOString()).toBe('2026-11-11T08:00:00.000Z');
    expect(
      firstFreeSlot([], at('2026-11-10T07:00:00Z'), 11 * 3_600_000, at('2026-11-20T00:00:00Z')),
    ).toBeNull();
  });

  it('maintenance : échéance, jamais entretenu, interventions répétées ; justificatifs', () => {
    const list = factureMaintenanceCandidates(
      [
        {
          id: 'due',
          installedAt: at('2025-01-01T00:00:00Z'),
          maintenanceIntervalMonths: 6,
          history: [{ number: 'INT-1', completedAt: at('2026-05-01T00:00:00Z') }],
        },
        {
          id: 'never',
          installedAt: at('2024-06-01T00:00:00Z'),
          maintenanceIntervalMonths: null,
          history: [],
        },
        {
          id: 'repeated',
          installedAt: null,
          maintenanceIntervalMonths: null,
          history: [
            { number: 'INT-2', completedAt: at('2026-09-01T00:00:00Z') },
            { number: 'INT-3', completedAt: at('2026-10-15T00:00:00Z') },
          ],
        },
        {
          id: 'fine',
          installedAt: at('2026-01-01T00:00:00Z'),
          maintenanceIntervalMonths: 12,
          history: [{ number: 'INT-4', completedAt: at('2026-10-01T00:00:00Z') }],
        },
      ],
      now,
    );
    expect(list.map((c) => [c.equipmentId, c.reasons, c.evidence])).toEqual([
      ['due', ['DUE'], ['INT-1']],
      ['never', ['NEVER_SERVICED'], []],
      ['repeated', ['REPEATED'], ['INT-3', 'INT-2']],
    ]);
    expect(list[0]!.dueDate!.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('aucune panne annoncée comme certaine', () => {
    expect(factureAiClaimsCertainty('Le compresseur tombera en panne cet été.')).toBe(true);
    expect(factureAiClaimsCertainty('Panne certaine du ventilateur.')).toBe(true);
    expect(factureAiClaimsCertainty('Vérification recommandée du ventilateur.')).toBe(false);
  });
});
