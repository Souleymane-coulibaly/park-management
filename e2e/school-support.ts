import { existsSync, readFileSync } from 'node:fs';
import { type APIRequestContext, type Browser, type Page, expect, test } from '@playwright/test';
import { parse } from 'dotenv';
import { PrismaClient, type SuiteContractStatus, resolveTestDatabase } from '@ocall/database';
import { resolveSchoolTestDatabase } from './school-database';
import { E2E_SUFFIX, PASSWORD, uniqueEmail } from './support';

/**
 * Support des E2E Ocall School : données fictives uniquement, sur les bases de TEST (Suite et School).
 * Les organisations portent le suffixe E2E : global-teardown les supprime des deux bases.
 */
const apiEnv = existsSync('apps/api/.env') ? parse(readFileSync('apps/api/.env')) : {};
const testDb = resolveTestDatabase({ ...apiEnv, ...process.env });
const schoolUrl = resolveSchoolTestDatabase({ ...apiEnv, ...process.env }, testDb.databaseUrl);

/** À appeler en tête de chaque fichier School : ignoré sans base School de test, exigé en CI. */
export function requireSchool(): void {
  if (process.env.CI && !schoolUrl) {
    throw new Error('CI : TEST_SCHOOL_DATABASE_URL est obligatoire pour les E2E Ocall School.');
  }
  test.skip(!schoolUrl, 'Base School de test absente (TEST_SCHOOL_DATABASE_URL)');
}

export interface SchoolClient {
  email: string;
  organizationId: string;
}

/**
 * Client Ocall School sur contrat : inscription par l'API (comme un client réel), puis contrat posé
 * sur la base de test (en exploitation, c'est l'équipe Ocall qui le crée, sous double authentification).
 * Organisation sans activité Park : `/app` la renvoie au portail de la Suite.
 */
export async function seedSchoolClient(
  request: APIRequestContext,
  label: string,
  status: SuiteContractStatus = 'ACTIVE',
): Promise<SchoolClient> {
  const email = uniqueEmail(`school-${label}`);
  const res = await request.post('/api/v1/auth/signup', {
    data: {
      organizationName: `Groupe ${label} ${E2E_SUFFIX}`,
      businessType: 'PARK',
      countryCode: 'SN',
      establishmentName: `Siège ${label}`,
      firstName: 'Mariama',
      lastName: 'Sow',
      email,
      password: PASSWORD,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { organization: { id: string }; user: { id: string } };
  const organizationId = body.organization.id;
  const db = new PrismaClient({ datasourceUrl: testDb.databaseUrl });
  try {
    const product = await db.saasProduct.findUniqueOrThrow({ where: { code: 'OCALL_SCHOOL' } });
    await db.organization.update({ where: { id: organizationId }, data: { businessType: 'NONE' } });
    await db.suiteContract.create({
      data: {
        organizationId,
        productId: product.id,
        reference: `OCS-E2E-${organizationId.slice(0, 8)}`,
        status,
        startsOn: new Date('2026-01-01'),
        endsOn: new Date('2099-12-31'),
        createdById: body.user.id,
      },
    });
  } finally {
    await db.$disconnect();
  }
  return { email, organizationId };
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

/** Appel de l'API depuis la page (cookie de session du navigateur), pour préparer les données. */
export function apiCaller(page: Page) {
  return async <T = any>(url: string, method = 'GET', body?: unknown): Promise<ApiResult<T>> =>
    page.evaluate(
      async ({ url, method, body }) => {
        const r = await fetch('/api/v1' + url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await r.text();
        let parsed: unknown = text;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          /* réponse non JSON conservée telle quelle */
        }
        return { status: r.status, body: parsed as any };
      },
      { url, method, body },
    );
}

export type Api = ReturnType<typeof apiCaller>;

/** Comme `apiCaller`, mais échoue immédiatement sur une réponse d'erreur (préparation des données). */
export function seeder(page: Page) {
  const call = apiCaller(page);
  return async <T = any>(url: string, method = 'GET', body?: unknown): Promise<T> => {
    const res = await call<T>(url, method, body);
    expect(res.status, `${method} ${url} : ${JSON.stringify(res.body)}`).toBeLessThan(300);
    return res.body;
  };
}

export async function loginTo(page: Page, identifier: string, landing: RegExp = /\/suite$/) {
  await page.goto('/connexion');
  await page.getByLabel('E-mail ou identifiant').fill(identifier);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(landing, { timeout: 30_000 });
}

/** Établissement courant de l'espace School (sélecteur mémorisé par le navigateur). */
export async function chooseSchool(page: Page, schoolId: string) {
  await page.evaluate((v) => localStorage.setItem('ocp.school.current', v), schoolId);
}

export interface CreatedMember {
  member: { id: string; loginId: string };
  temporaryPassword: string;
}

/** Membre créé par la direction : première connexion et changement du mot de passe temporaire. */
export async function memberPage(
  browser: Browser,
  created: CreatedMember,
  schoolId: string,
  errors: string[],
): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'fr-FR', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/connexion');
  const call = seeder(page);
  await call('/auth/login', 'POST', {
    identifier: created.member.loginId,
    password: created.temporaryPassword,
  });
  await call('/auth/change-password', 'POST', {
    currentPassword: created.temporaryPassword,
    newPassword: PASSWORD,
  });
  await chooseSchool(page, schoolId);
  return page;
}

/**
 * Année scolaire EN COURS (septembre à juillet) : l'appel du jour, les échéances en retard et les
 * périodes restent cohérents quelle que soit la date d'exécution des tests.
 */
export function currentSchoolYear(now = new Date()): { startYear: number; label: string } {
  const startYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { startYear, label: `${startYear}-${startYear + 1}` };
}

export interface SchoolFixture {
  id: string;
  startYear: number;
  yearId: string;
  levelId: string;
  classId: string;
  periodIds: string[];
  subjects: Record<string, string>;
}

/** Établissement complet : année ouverte, deux trimestres, une classe de CM1, matières activées. */
export async function seedSchool(
  call: ReturnType<typeof seeder>,
  body: { name: string; nameAr?: string; defaultLocale?: 'FR' | 'BILINGUAL' | 'AR' },
  subjects: [key: string, coefficient: number][] = [['mathematiques', 3]],
): Promise<SchoolFixture> {
  const school = await call('/school/schools', 'POST', {
    type: 'FRANCO_ARABIC',
    countryCode: 'SN',
    ...body,
  });
  const { startYear: y, label } = currentSchoolYear();
  const year = await call('/school/years', 'POST', {
    schoolId: school.id,
    label,
    startsOn: `${y}-09-01`,
    endsOn: `${y + 1}-07-31`,
  });
  await call(`/school/years/${year.id}/status`, 'POST', { status: 'ACTIVE' });
  const periodIds: string[] = [];
  for (const [label, labelAr, startsOn, endsOn] of [
    ['Trimestre 1', 'الفصل الأول', `${y}-09-01`, `${y}-12-20`],
    ['Trimestre 2', 'الفصل الثاني', `${y + 1}-01-04`, `${y + 1}-03-31`],
  ]) {
    const period = await call('/school/periods', 'POST', {
      schoolYearId: year.id,
      kind: 'TRIMESTER',
      label,
      labelAr,
      startsOn,
      endsOn,
    });
    periodIds.push(period.id);
  }
  const cycle = await call('/school/cycles', 'POST', {
    schoolId: school.id,
    name: 'Primaire',
    nameAr: 'الابتدائي',
  });
  const level = await call('/school/levels', 'POST', {
    cycleId: cycle.id,
    name: 'CM1',
    nameAr: 'السنة الرابعة',
  });
  const cls = await call('/school/classes', 'POST', {
    schoolYearId: year.id,
    levelId: level.id,
    name: 'CM1 A',
    nameAr: 'الرابعة أ',
    capacity: 30,
  });
  const ids: Record<string, string> = {};
  for (const [key, coefficient] of subjects) {
    const subject = await call(`/school/subjects/catalog/${key}/activate`, 'POST', {
      schoolId: school.id,
    });
    await call(`/school/subjects/${subject.id}/levels`, 'PUT', {
      levels: [{ levelId: level.id, coefficient }],
    });
    ids[key] = subject.id;
  }
  return {
    id: school.id,
    startYear: y,
    yearId: year.id,
    levelId: level.id,
    classId: cls.id,
    periodIds,
    subjects: ids,
  };
}

/** Élève fictif inscrit et validé dans la classe, avec un responsable principal. */
export async function seedStudent(
  call: ReturnType<typeof seeder>,
  s: SchoolFixture,
  lastName: string,
  firstName: string,
  ar?: { lastNameAr: string; firstNameAr: string },
): Promise<{ studentId: string; guardianId: string }> {
  const student = await call('/school/students', 'POST', {
    schoolId: s.id,
    lastName,
    firstName,
    ...ar,
    birthDate: '2016-03-14',
  });
  const guardian = await call('/school/guardians', 'POST', {
    schoolId: s.id,
    lastName,
    firstName: 'Ousmane',
    phone: '+221 77 000 00 01',
  });
  await call(`/school/students/${student.id}/guardians`, 'POST', {
    guardianId: guardian.id,
    relation: 'FATHER',
  });
  const enrollment = await call('/school/enrollments', 'POST', {
    studentId: student.id,
    schoolYearId: s.yearId,
    levelId: s.levelId,
    classId: s.classId,
    submit: true,
  });
  await call(`/school/enrollments/${enrollment.id}/status`, 'POST', { status: 'VALIDATED' });
  return { studentId: student.id, guardianId: guardian.id };
}

/**
 * Aucun débordement horizontal sur téléphone : ni le document, ni un élément de `main` hors d'un
 * conteneur défilant (le document seul ne voit pas un débordement contenu dans une colonne).
 */
export async function expectNoOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const w = window.innerWidth;
    const bad = [...document.querySelectorAll('main *')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0) return false;
      for (let p = e.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return false;
      }
      return r.right > w + 1 || r.left < -1;
    });
    return { doc: document.documentElement.scrollWidth - w, count: bad.length };
  });
  expect(result).toEqual({ doc: expect.any(Number), count: 0 });
  expect(result.doc).toBeLessThanOrEqual(0);
}
