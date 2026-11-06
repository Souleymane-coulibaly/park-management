import type { PlanningConflict } from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolTimetablesService } from './school-timetables.service';

/**
 * Conflits de planning restitués à l'utilisateur (contrats multiples) : la détection reste globale, mais
 * un conflit avec une classe d'un établissement hors du périmètre de la requête ne révèle ni la classe
 * ni le créneau.
 */
describe('conflits de planning : détails limités au périmètre de la requête', () => {
  const service = new SchoolTimetablesService(
    ...(Array(7).fill(null) as ConstructorParameters<typeof SchoolTimetablesService>),
  );
  const classes = [
    { id: 'class-a', name: 'CM1 A', nameAr: null, year: { schoolId: 'school-a' } },
    { id: 'class-b', name: 'CM1 B', nameAr: null, year: { schoolId: 'school-b' } },
  ];
  const tx = { schoolClass: { findMany: jest.fn().mockResolvedValue(classes) } };
  const conflicts: PlanningConflict[] = [
    {
      code: 'SLOT_TEACHER_CONFLICT',
      slotId: 'slot-a',
      classId: 'class-a',
      weekday: 1,
      start: 480,
      end: 540,
    },
    {
      code: 'SLOT_TEACHER_CONFLICT',
      slotId: 'slot-b',
      classId: 'class-b',
      weekday: 1,
      start: 480,
      end: 540,
    },
  ];
  const named = (ctx: Partial<SchoolContext>) =>
    (
      service as unknown as {
        withClassNames(db: unknown, ctx: unknown, c: PlanningConflict[]): Promise<unknown[]>;
      }
    ).withClassNames(tx, { organizationId: 'org', ...ctx }, conflicts);

  it('classe d’un établissement hors périmètre : ni classe ni créneau', async () => {
    const result = await named({ schoolIds: ['school-a'] });
    expect(result).toEqual([
      expect.objectContaining({
        slotId: 'slot-a',
        class: { id: 'class-a', name: 'CM1 A', nameAr: null },
      }),
      expect.objectContaining({
        code: 'SLOT_TEACHER_CONFLICT',
        slotId: null,
        class: null,
        start: '08:00',
      }),
    ]);
    // Classes recherchées dans l'organisation de la requête seulement.
    expect(tx.schoolClass.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org' }) }),
    );
  });

  it('périmètre complet : tout est restitué', async () => {
    const result = await named({ schoolIds: null });
    expect(result).toEqual([
      expect.objectContaining({
        slotId: 'slot-a',
        class: expect.objectContaining({ id: 'class-a' }),
      }),
      expect.objectContaining({
        slotId: 'slot-b',
        class: expect.objectContaining({ id: 'class-b' }),
      }),
    ]);
  });
});
