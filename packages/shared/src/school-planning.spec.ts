import { addDays } from './park';
import {
  type PlanningSlot,
  closureApplies,
  datesOverlap,
  isClosure,
  isoWeekday,
  minutesToTime,
  rangesOverlap,
  slotConflicts,
  timeToMinutes,
  weekStart,
  weekdayOccurs,
} from './school-planning';
import { portalNotificationHref } from './school-portal';

const base: PlanningSlot = {
  id: 'a',
  timetableId: 't1',
  classId: 'c1',
  groupId: null,
  kind: 'LESSON',
  weekday: 1,
  start: 480,
  end: 540,
  memberId: 'm1',
  roomId: 'r1',
  validFrom: '2026-10-01',
  validTo: '2027-06-30',
};
const candidate = (patch: Partial<PlanningSlot>): PlanningSlot => ({
  ...base,
  id: 'new',
  ...patch,
});
const codes = (slot: PlanningSlot, others: PlanningSlot[]) =>
  slotConflicts(slot, others).map((c) => c.code);

describe('Ocall School — planning (règles)', () => {
  it('heures : conversion dans les deux sens, valeurs invalides refusées', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(minutesToTime(510)).toBe('08:30');
    expect(minutesToTime(1440)).toBe('24:00');
    expect(() => timeToMinutes('8:30')).toThrow(RangeError);
    expect(() => timeToMinutes('24:00')).toThrow(RangeError);
    expect(() => minutesToTime(1441)).toThrow(RangeError);
  });

  it('chevauchements : plages contiguës autorisées, dates incluses', () => {
    expect(rangesOverlap(480, 540, 540, 600)).toBe(false);
    expect(rangesOverlap(480, 541, 540, 600)).toBe(true);
    expect(datesOverlap('2026-10-01', '2026-12-20', '2026-12-20', '2027-03-01')).toBe(true);
    expect(datesOverlap('2026-10-01', '2026-12-19', '2026-12-20', '2027-03-01')).toBe(false);
  });

  it('jours ISO et semaines, indépendants du fuseau', () => {
    expect(isoWeekday('2026-11-02')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
    expect(weekStart('2026-11-05')).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('conflits : même classe, enseignant, salle ; autres jours et horaires libres', () => {
    expect(codes(candidate({}), [base])).toEqual(['SLOT_CLASS_OVERLAP']);
    const otherClass = { classId: 'c2', timetableId: 't2' };
    expect(codes(candidate({ ...otherClass, roomId: null }), [base])).toEqual([
      'SLOT_TEACHER_CONFLICT',
    ]);
    expect(codes(candidate({ ...otherClass, memberId: 'm2' }), [base])).toEqual([
      'SLOT_ROOM_CONFLICT',
    ]);
    expect(codes(candidate({ ...otherClass, memberId: 'm2', roomId: 'r2' }), [base])).toEqual([]);
    expect(codes(candidate({ weekday: 2 }), [base])).toEqual([]);
    expect(codes(candidate({ start: 540, end: 600 }), [base])).toEqual([]);
    // Le créneau modifié n'est jamais en conflit avec lui-même.
    expect(codes({ ...base }, [base])).toEqual([]);
  });

  it('groupes d’une même classe en parallèle ; pauses sans enseignant ni salle', () => {
    const g1 = { ...base, groupId: 'g1' };
    expect(codes(candidate({ groupId: 'g2', memberId: 'm2', roomId: 'r2' }), [g1])).toEqual([]);
    expect(codes(candidate({ groupId: 'g2', roomId: 'r2' }), [g1])).toEqual([
      'SLOT_TEACHER_CONFLICT',
    ]);
    expect(codes(candidate({ groupId: null, memberId: 'm2', roomId: 'r2' }), [g1])).toEqual([
      'SLOT_CLASS_OVERLAP',
    ]);
    const pause = candidate({ kind: 'BREAK', memberId: null, roomId: null, classId: 'c2' });
    expect(codes(pause, [base])).toEqual([]);
  });

  it('occurrence commune : le jour doit exister dans l’intersection des validités', () => {
    expect(weekdayOccurs(1, '2026-11-04', '2026-11-04')).toBe(false);
    expect(weekdayOccurs(3, '2026-11-04', '2026-11-04')).toBe(true);
    expect(weekdayOccurs(1, '2026-11-03', '2026-11-09')).toBe(true);
    // Lundi : 2 novembre dans la première version, 9 novembre dans la seconde ; seul le 4 est commun.
    const first = { ...base, validFrom: '2026-11-02', validTo: '2026-11-04' };
    const second = candidate({
      classId: 'c2',
      timetableId: 't2',
      roomId: null,
      validFrom: '2026-11-04',
      validTo: '2026-11-09',
    });
    expect(codes(second, [first])).toEqual([]);
    expect(codes({ ...second, validTo: '2026-11-16', validFrom: '2026-11-02' }, [first])).toEqual([
      'SLOT_TEACHER_CONFLICT',
    ]);
  });

  it('validités : versions sans recouvrement ou autre version de la même classe ignorées', () => {
    const later = { classId: 'c2', timetableId: 't2', validFrom: '2027-01-01', roomId: null };
    expect(codes(candidate(later), [{ ...base, validTo: '2026-12-31' }])).toEqual([]);
    expect(codes(candidate({ timetableId: 't9' }), [base])).toEqual([]);
  });

  it('créneau sans occurrence dans sa validité : ni conflit ni indisponibilité', () => {
    // Version du mercredi 4 au vendredi 6 novembre : aucun lundi.
    const short = candidate({
      classId: 'c2',
      timetableId: 't2',
      validFrom: '2026-11-04',
      validTo: '2026-11-06',
    });
    expect(
      slotConflicts(short, [base], [{ memberId: 'm1', weekday: 1, start: 0, end: 1440 }]),
    ).toEqual([]);
  });

  it('indisponibilité de l’enseignant', () => {
    const conflicts = slotConflicts(
      candidate({ classId: 'c2', timetableId: 't2' }),
      [],
      [{ memberId: 'm1', weekday: 1, start: 510, end: 600 }],
    );
    expect(conflicts.map((c) => c.code)).toEqual(['SLOT_TEACHER_UNAVAILABLE']);
    expect(
      slotConflicts(candidate({}), [], [{ memberId: 'm1', weekday: 1, start: 540, end: 600 }]),
    ).toEqual([]);
  });

  it('fermetures : catégories, portée par classe', () => {
    expect(isClosure('HOLIDAY')).toBe(true);
    expect(isClosure('PARENT_MEETING')).toBe(false);
    const target = { schoolId: 's1', classId: 'c1', groupIds: [] as string[] };
    const event = { schoolId: 's1', classIds: [] as string[], groupIds: [] as string[] };
    expect(closureApplies({ ...event, audience: 'SCHOOL' }, target)).toBe(true);
    // Fermeture d'un autre établissement : jamais appliquée.
    expect(closureApplies({ ...event, schoolId: 's2', audience: 'SCHOOL' }, target)).toBe(false);
    expect(closureApplies({ ...event, audience: 'CLASSES', classIds: ['c2'] }, target)).toBe(false);
    expect(closureApplies({ ...event, audience: 'CLASSES', classIds: ['c1'] }, target)).toBe(true);
    // Fermeture d'un groupe : ses cours seulement, jamais ceux de toute la classe ni d'un autre groupe.
    const g1 = { ...event, audience: 'GROUPS' as const, groupIds: ['g1'] };
    expect(closureApplies(g1, { ...target, groupIds: ['g1'] })).toBe(true);
    expect(closureApplies(g1, { ...target, groupIds: ['g2'] })).toBe(false);
    expect(closureApplies(g1, target)).toBe(false);
  });

  it('notifications du planning : liens du portail', () => {
    expect(portalNotificationHref('TIMETABLE', 'abc')).toBe('/parents/enfants/abc/planning');
    expect(portalNotificationHref('EXAM', 'abc')).toBe('/parents/enfants/abc/planning');
    expect(portalNotificationHref('EVENT', 'abc')).toBe('/parents/calendrier');
  });
});
