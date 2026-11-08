import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SchoolLocale } from '@ocall/shared';
import { type ReportCardView, renderReportCards } from './school-report-card.pdf';

/** Données fictives uniquement. */
function view(locale: SchoolLocale, patch: Partial<ReportCardView> = {}): ReportCardView {
  return {
    locale,
    school: {
      name: 'École Les Palmiers',
      nameAr: 'مدرسة النخيل',
      address: '12 rue des Écoles, Dakar',
      phone: '+221 33 000 00 00',
      email: null,
    },
    yearLabel: '2026-2027',
    period: { label: 'Premier trimestre', labelAr: 'الفصل الأول' },
    student: {
      lastName: 'Diallo',
      firstName: 'Awa',
      lastNameAr: 'ديالو',
      firstNameAr: 'عوا',
      matricule: 'PAL-2026-000123',
      birthDate: '2015-03-14',
    },
    class: { name: 'CM1 A', nameAr: 'السنة الرابعة أ', size: 28 },
    scale: 20,
    decimals: 2,
    subjects: [
      {
        name: 'Mathématiques',
        nameAr: 'الرياضيات',
        coefficient: 3,
        average: 14.67,
        classAverage: 11.2,
        appreciation: 'Bon trimestre, travail régulier.',
        appreciationAr: 'فصل جيد، عمل منتظم (ممتاز في الهندسة) : 15 / 20.',
      },
      {
        name: 'Langue arabe',
        nameAr: 'اللغة العربية',
        coefficient: 2,
        average: 15,
        classAverage: 12.75,
        appreciation: null,
        appreciationAr: 'قراءة متقنة.',
      },
      {
        name: 'Éducation physique et sportive',
        nameAr: null,
        coefficient: 1,
        average: null,
        classAverage: 13,
        appreciation: 'Dispensée ce trimestre.',
        appreciationAr: null,
      },
    ],
    generalAverage: 14.8,
    classAverage: 12.1,
    rankingEnabled: true,
    rank: 3,
    tied: true,
    rankedCount: 27,
    directionComment: 'Félicitations, continuez ainsi.',
    directionCommentAr: 'تهانينا، واصلي على هذا النحو.',
    issuedOn: '2026-12-20',
    provisional: false,
    ...patch,
  };
}

describe('Ocall School — bulletin PDF', () => {
  it.each(['FR', 'AR', 'BILINGUAL'] as const)('génère un PDF valide en %s', async (locale) => {
    const pdf = await renderReportCards([view(locale)]);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5000);
    // Polices incorporées : l'arabe n'est jamais dessiné avec une police latine.
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/NotoSans/);
    if (locale === 'FR') expect(raw).not.toMatch(/NotoNaskhArabic/);
    else expect(raw).toMatch(/NotoNaskhArabic/);
    if (process.env.SCHOOL_PDF_OUT) {
      writeFileSync(join(process.env.SCHOOL_PDF_OUT, `bulletin-${locale}.pdf`), pdf);
    }
  });

  it('plusieurs élèves : une page chacun ; mention provisoire ; aucun champ arabe exigé', async () => {
    const noArabic = view('AR', {
      provisional: true,
      school: { name: 'École sans arabe', nameAr: null, address: null, phone: null, email: null },
      student: { ...view('AR').student, lastNameAr: null, firstNameAr: null, birthDate: null },
      period: { label: 'Semestre 1', labelAr: null },
      class: { name: '6e B', nameAr: null, size: 30 },
      directionComment: null,
      directionCommentAr: null,
      rankingEnabled: false,
    });
    const pdf = await renderReportCards([view('FR'), noArabic]);
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages).toHaveLength(2);
  });

  it('beaucoup de matières : le tableau continue sur une nouvelle page', async () => {
    const subjects = Array.from({ length: 40 }, (_, i) => ({
      ...view('FR').subjects[0]!,
      name: `Matière ${i + 1}`,
    }));
    const pdf = await renderReportCards([view('BILINGUAL', { subjects })]);
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });
});
