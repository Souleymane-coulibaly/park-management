import { type SchoolCurrency, type SchoolReportKind, toMajorUnits } from '@ocall/shared';
import type { ReportDocument, ReportLocale, ReportSection } from './school-report-export';
import { reportTitle } from './school-report-export';
import type {
  FinanceDashboard,
  ReportHeader,
  SchoolReportingService,
} from './school-reporting.service';

type Overview = Awaited<ReturnType<SchoolReportingService['overview']>>;
type Pedagogy = Awaited<ReturnType<SchoolReportingService['pedagogy']>>;
type Attendance = Awaited<ReturnType<SchoolReportingService['attendance']>>;
type Finance = ReportHeader & FinanceDashboard;

/** Libellés de colonnes, en français ou en arabe selon la langue de l'établissement. */
const C = {
  FR: {
    indicator: 'Indicateur',
    value: 'Valeur',
    activeStudents: 'Élèves actifs',
    unplaced: 'Élèves sans classe',
    classes: 'Classes',
    teachers: 'Enseignants',
    class: 'Classe',
    students: 'Élèves',
    capacity: 'Capacité',
    presenceRate: 'Taux de présence (%)',
    absenceRate: 'Taux d’absence (%)',
    lateRate: 'Taux de retard (%)',
    sessions: 'Relevés',
    present: 'Présents',
    absent: 'Absents',
    excused: 'Absences justifiées',
    late: 'Retards',
    minutesLate: 'Minutes de retard',
    month: 'Mois',
    average: 'Moyenne',
    passRate: 'Réussite (%)',
    graded: 'Élèves notés',
    scale: 'Barème',
    scaleMixed: 'barèmes différents',
    period: 'Période',
    subject: 'Matière',
    min: 'Min.',
    max: 'Max.',
    trend: 'Tendance',
    insufficient: 'Effectif insuffisant',
    notStarted: 'année non commencée',
    validated: 'Validé',
    yes: 'Oui',
    no: 'Non',
    expected: 'Facturé',
    collected: 'Encaissé',
    collectedYear: 'Encaissé (cumul de l’année)',
    periodCollected: 'Encaissé sur la période',
    balance: 'Reste dû',
    overdueAmount: 'Échu impayé',
    overdueCharges: 'Échéances dépassées',
    arrears: 'Élèves en impayé',
    amount: 'Montant',
    method: 'Moyen',
    level: 'Niveau',
    sKey: 'Indicateurs clés',
    sByClass: 'Répartition par classe',
    sResults: 'Résultats de la dernière période',
    sSchool: 'Établissement par période',
    sClasses: 'Classes par période',
    sSubjects: 'Matières par période',
    sDistribution: 'Répartition des moyennes',
    sMonths: 'Par mois',
    sMethods: 'Par moyen de paiement',
    range: 'Tranche',
    count: 'Effectif',
    UP: 'Hausse',
    DOWN: 'Baisse',
    STABLE: 'Stable',
    INSUFFICIENT: 'Données insuffisantes',
  },
  AR: {
    indicator: 'المؤشر',
    value: 'القيمة',
    activeStudents: 'التلاميذ النشطون',
    unplaced: 'تلاميذ بلا قسم',
    classes: 'الأقسام',
    teachers: 'المعلمون',
    class: 'القسم',
    students: 'التلاميذ',
    capacity: 'السعة',
    presenceRate: 'نسبة الحضور (%)',
    absenceRate: 'نسبة الغياب (%)',
    lateRate: 'نسبة التأخر (%)',
    sessions: 'السجلات',
    present: 'حاضرون',
    absent: 'غائبون',
    excused: 'غياب مبرر',
    late: 'متأخرون',
    minutesLate: 'دقائق التأخر',
    month: 'الشهر',
    average: 'المعدل',
    passRate: 'النجاح (%)',
    graded: 'تلاميذ لهم معدل',
    scale: 'السلم',
    scaleMixed: 'سلالم تنقيط مختلفة',
    period: 'الفترة',
    subject: 'المادة',
    min: 'الأدنى',
    max: 'الأعلى',
    trend: 'الاتجاه',
    insufficient: 'عدد غير كاف',
    notStarted: 'السنة لم تبدأ بعد',
    validated: 'مصادق عليه',
    yes: 'نعم',
    no: 'لا',
    expected: 'المفوتر',
    collected: 'المحصل',
    collectedYear: 'المحصل (مجموع السنة)',
    periodCollected: 'المحصل خلال الفترة',
    balance: 'الباقي',
    overdueAmount: 'المستحق غير المدفوع',
    overdueCharges: 'أقساط متأخرة',
    arrears: 'تلاميذ عليهم متأخرات',
    amount: 'المبلغ',
    method: 'الوسيلة',
    level: 'المستوى',
    sKey: 'المؤشرات الرئيسية',
    sByClass: 'التوزيع حسب القسم',
    sResults: 'نتائج آخر فترة',
    sSchool: 'المؤسسة حسب الفترة',
    sClasses: 'الأقسام حسب الفترة',
    sSubjects: 'المواد حسب الفترة',
    sDistribution: 'توزيع المعدلات',
    sMonths: 'حسب الشهر',
    sMethods: 'حسب وسيلة الدفع',
    range: 'الشريحة',
    count: 'العدد',
    UP: 'ارتفاع',
    DOWN: 'انخفاض',
    STABLE: 'مستقر',
    INSUFFICIENT: 'بيانات غير كافية',
  },
} as const;

type Key = keyof (typeof C)['FR'];

/** Taux en points de base → pourcentage à une décimale ; vide si inconnu. */
const pct = (bp: number | null) => (bp === null ? '' : Math.round(bp / 10) / 10);
const num = (n: number | null) => (n === null ? '' : n);
/** Montant stocké en unités mineures, exporté dans l'unité de la devise (libellé « (EUR) »). */
const money = (minor: number, currency: string) => toMajorUnits(minor, currency as SchoolCurrency);

/** Barème d'une moyenne ; mention explicite quand la moyenne mélangerait plusieurs barèmes. */
function scaleCell(locale: ReportLocale, v: { scale: number | null; scaleMixed?: boolean }) {
  return v.scaleMixed ? C[locale].scaleMixed : num(v.scale);
}

function named(locale: ReportLocale, n: { name: string; nameAr: string | null }) {
  return locale === 'AR' ? n.nameAr || n.name : n.name;
}

function section(locale: ReportLocale, heading: Key, headers: Key[], rows: (string | number)[][]) {
  const t = C[locale];
  return {
    heading: t[heading],
    table: { headers: headers.map((h) => t[h]), rows },
  } satisfies ReportSection;
}

/** Document d'un rapport : titre, établissement, période et filtres lisibles, sections de tableaux. */
export function buildReportDocument(
  kind: SchoolReportKind,
  data: Overview | Pedagogy | Attendance | Finance,
  locale: ReportLocale,
  filterLabels: string[],
): ReportDocument {
  const header = data as ReportHeader;
  const base = {
    title: reportTitle(kind, locale),
    schoolName: named(locale, header.school),
    period: `${header.year.label} · ${header.from} → ${header.to}${header.yearNotStarted ? ` · ${C[locale].notStarted}` : ''}`,
    filters: filterLabels,
  };
  const t = C[locale];
  if (kind === 'overview') {
    const d = data as Overview;
    const sections: ReportSection[] = [
      section(
        locale,
        'sKey',
        ['indicator', 'value'],
        [
          [t.activeStudents, d.students.active],
          [t.unplaced, d.students.unplaced],
          [t.classes, d.classCount],
          [t.teachers, d.teachers],
          [t.presenceRate, pct(d.attendance.presenceRate)],
          [t.absenceRate, pct(d.attendance.absenceRate)],
          ...(d.results
            ? [
                [t.average, num(d.results.average)] as (string | number)[],
                [t.scale, scaleCell(locale, d.results)],
                [t.passRate, pct(d.results.passRate)],
                [t.graded, d.results.graded],
                [t.insufficient, d.results.insufficient ? t.yes : t.no],
              ]
            : []),
          ...(d.finance
            ? [
                [
                  `${t.expected} (${d.finance.currency})`,
                  money(d.finance.expected, d.finance.currency),
                ],
                [
                  `${t.collected} (${d.finance.currency})`,
                  money(d.finance.collected, d.finance.currency),
                ],
                [
                  `${t.balance} (${d.finance.currency})`,
                  money(d.finance.balance, d.finance.currency),
                ],
                [
                  `${t.overdueAmount} (${d.finance.currency})`,
                  money(d.finance.overdueAmount, d.finance.currency),
                ],
                [t.arrears, d.finance.studentsInArrears],
              ]
            : []),
        ],
      ),
      section(
        locale,
        'sByClass',
        ['class', 'students', 'capacity'],
        d.byClass.map((c) => [named(locale, c), c.students, num(c.capacity)]),
      ),
    ];
    if (d.results) {
      sections.push(
        section(
          locale,
          'sResults',
          ['class', 'average', 'scale', 'passRate', 'graded', 'insufficient'],
          d.results.byClass.map((c) => [
            named(locale, c),
            num(c.classAverage),
            scaleCell(locale, c),
            pct(c.passRate),
            c.graded,
            c.insufficient ? t.yes : t.no,
          ]),
        ),
      );
    }
    return { ...base, sections };
  }
  if (kind === 'pedagogy') {
    const d = data as Pedagogy;
    const periodName = new Map(
      d.periods.map((p) => [p.id, named(locale, { name: p.label, nameAr: p.labelAr })]),
    );
    return {
      ...base,
      sections: [
        section(
          locale,
          'sSchool',
          ['period', 'average', 'scale', 'passRate', 'graded', 'insufficient'],
          d.schoolByPeriod.map((p) => [
            periodName.get(p.periodId) ?? '',
            num(p.average),
            scaleCell(locale, p),
            pct(p.passRate),
            p.graded,
            p.insufficient ? t.yes : t.no,
          ]),
        ),
        section(
          locale,
          'sClasses',
          [
            'class',
            'period',
            'average',
            'scale',
            'passRate',
            'graded',
            'insufficient',
            'validated',
            'trend',
          ],
          d.classes.flatMap((c) =>
            c.periods.map((p) => [
              named(locale, c),
              periodName.get(p.periodId) ?? '',
              num(p.classAverage),
              scaleCell(locale, p),
              pct(p.passRate),
              p.graded,
              // Effectif insuffisant (moins de 3 élèves notés) : signalé comme à l'écran.
              p.insufficient ? t.yes : t.no,
              p.validated ? t.yes : t.no,
              t[c.trend.direction],
            ]),
          ),
        ),
        section(
          locale,
          'sSubjects',
          ['subject', 'period', 'average', 'scale', 'graded', 'insufficient', 'trend'],
          d.subjects.flatMap((s) =>
            s.byPeriod.map((p) => [
              named(locale, s),
              periodName.get(p.periodId) ?? '',
              num(p.average),
              scaleCell(locale, p),
              p.graded,
              // Effectif propre à la matière (moins de 3 élèves notés) : réserve comme à l'écran.
              p.graded > 0 && p.insufficient ? t.yes : t.no,
              s.trend ? t[s.trend.direction] : '',
            ]),
          ),
        ),
        section(
          locale,
          'sDistribution',
          ['class', 'period', 'range', 'count'],
          d.classes.flatMap((c) =>
            c.periods.flatMap((p) =>
              p.distribution.bins.map((b) => [
                named(locale, c),
                periodName.get(p.periodId) ?? '',
                `${b.from} – ${b.to}`,
                b.count,
              ]),
            ),
          ),
        ),
      ],
    };
  }
  if (kind === 'attendance') {
    const d = data as Attendance;
    return {
      ...base,
      sections: [
        section(
          locale,
          'sByClass',
          [
            'class',
            'sessions',
            'present',
            'absent',
            'excused',
            'late',
            'absenceRate',
            'minutesLate',
          ],
          d.byClass.map((c) => [
            named(locale, c),
            c.records,
            c.present,
            c.absent,
            c.excused,
            c.late,
            pct(c.absenceRate),
            c.minutesLate,
          ]),
        ),
        section(
          locale,
          'sMonths',
          ['month', 'sessions', 'present', 'absent', 'excused', 'late', 'absenceRate'],
          d.byMonth.map((m) => [
            m.month,
            m.sessions,
            m.present,
            m.absent,
            m.excused,
            m.late,
            pct(m.absenceRate),
          ]),
        ),
      ],
    };
  }
  const d = data as Finance;
  return {
    ...base,
    sections: [
      section(
        locale,
        'sKey',
        ['indicator', 'value'],
        [
          [`${t.expected} (${d.currency})`, money(d.expected, d.currency)],
          // Cumul de l'année à ce jour, distinct des encaissements de la période filtrée.
          [`${t.collectedYear} (${d.currency})`, money(d.collected, d.currency)],
          ...(d.periodCollected !== null
            ? [
                [`${t.periodCollected} (${d.currency})`, money(d.periodCollected, d.currency)] as (
                  string | number
                )[],
              ]
            : []),
          [`${t.balance} (${d.currency})`, money(d.balance, d.currency)],
          [`${t.overdueAmount} (${d.currency})`, money(d.overdueAmount, d.currency)],
          [t.overdueCharges, d.overdueCharges],
          [t.arrears, d.studentsInArrears],
        ],
      ),
      d.periodCollected !== null
        ? section(
            locale,
            'sByClass',
            ['class', 'level', 'expected', 'collectedYear', 'periodCollected', 'balance'],
            d.byClass.map((c) => [
              c.className,
              c.levelName,
              money(c.expected, d.currency),
              money(c.collected, d.currency),
              money(c.periodCollected ?? 0, d.currency),
              money(c.balance, d.currency),
            ]),
          )
        : section(
            locale,
            'sByClass',
            ['class', 'level', 'expected', 'collectedYear', 'balance'],
            d.byClass.map((c) => [
              c.className,
              c.levelName,
              money(c.expected, d.currency),
              money(c.collected, d.currency),
              money(c.balance, d.currency),
            ]),
          ),
      section(
        locale,
        'sMonths',
        ['month', 'amount'],
        d.collectionsByMonth.map((m) => [m.month, money(m.amount, d.currency)]),
      ),
      section(
        locale,
        'sMethods',
        ['method', 'amount'],
        d.collectionsByMethod.map((m) => [m.method, money(m.amount, d.currency)]),
      ),
    ],
  };
}
