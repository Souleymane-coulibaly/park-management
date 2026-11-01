import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import {
  SCHOOL_IMPORT_MAX_BYTES,
  SCHOOL_PHONE,
  SCHOOL_ENROLLMENT_STATUS_LABELS,
  SCHOOL_STUDENT_STATUS_LABELS,
  isValidMatricule,
  normalizeSearch,
  parseSchoolDate,
  parseSchoolSex,
  studentIdentityKey,
  suggestImportMapping,
  type SchoolImportField,
  type SchoolImportMapping,
  type SchoolSex,
} from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolEnrollmentsService } from './school-enrollments.service';
import { SchoolGuardiansService } from './school-guardians.service';
import { SchoolPrismaService } from './school-prisma.service';
import { parseSheet, toCsv, toXlsx, type TableExport } from './school-spreadsheet';
import type { ExportQueryDto, ImportDto } from './school-students.dto';
import { STUDENT_REVIEW_MESSAGE, SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const REPORT_MAX = 500;
const IMPORT_LIMITS: [SchoolImportField, number][] = [
  ['lastNameAr', 120],
  ['firstNameAr', 120],
  ['birthPlace', 120],
  ['nationality', 80],
  ['address', 300],
  ['guardianLastName', 120],
  ['guardianFirstName', 120],
];

/** Une anomalie de ligne : un code et un champ, jamais la valeur (rapport conservé sans donnée personnelle). */
interface LineIssue {
  line: number;
  field?: SchoolImportField;
  code: string;
  message: string;
}

interface CleanRow {
  line: number;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
  birthDate: string;
  birthPlace: string | null;
  sex: SchoolSex | null;
  nationality: string | null;
  address: string | null;
  matricule: string | null;
  levelId: string | null;
  classId: string | null;
  guardian: { lastName: string; firstName: string; phone: string } | null;
}

interface Analysis {
  format: 'CSV' | 'XLSX';
  headers: string[];
  mapping: SchoolImportMapping;
  total: number;
  valid: CleanRow[];
  duplicates: LineIssue[];
  errors: LineIssue[];
}

/** Import en deux temps : analyse sans écriture, puis une transaction par ligne. Un nouvel envoi est sans risque. */
@Injectable()
export class SchoolImportsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
    private readonly enrollments: SchoolEnrollmentsService,
    private readonly guardians: SchoolGuardiansService,
  ) {}

  async preview(ctx: SchoolContext, dto: ImportDto, file: Buffer | undefined) {
    const analysis = await this.analyze(ctx, dto, file);
    return {
      format: analysis.format,
      headers: analysis.headers,
      mapping: analysis.mapping,
      total: analysis.total,
      valid: analysis.valid.length,
      duplicates: analysis.duplicates,
      errors: analysis.errors.slice(0, REPORT_MAX),
      sample: analysis.valid
        .slice(0, 5)
        .map(({ line, lastName, firstName, lastNameAr, firstNameAr, birthDate, matricule }) => ({
          line,
          lastName,
          firstName,
          lastNameAr,
          firstNameAr,
          birthDate,
          matricule,
        })),
    };
  }

  async commit(ctx: SchoolContext, dto: ImportDto, file: Buffer | undefined) {
    const analysis = await this.analyze(ctx, dto, file);
    if (analysis.errors.length > 0 && dto.skipInvalid !== 'true') {
      throw new ConflictException({
        code: 'IMPORT_HAS_ERRORS',
        message: 'Corrigez les lignes en erreur, ou choisissez de les ignorer.',
        details: analysis.errors.slice(0, 20).map((e) => `Ligne ${e.line} : ${e.message}`),
      });
    }
    const year = await this.students.matriculeYear(
      ctx.organizationId,
      dto.schoolId,
      dto.schoolYearId,
    );
    const failures: LineIssue[] = [];
    let created = 0;
    for (const row of analysis.valid) {
      try {
        await this.db.$transaction((tx) => this.importRow(tx, ctx, dto, row, year));
        created++;
      } catch (error) {
        failures.push({
          line: row.line,
          code: errorCode(error),
          message: 'Ligne refusée lors de l’enregistrement.',
        });
      }
    }
    const errors = [...analysis.errors, ...failures];
    const job = await this.db.schoolImportJob.create({
      data: {
        organizationId: ctx.organizationId,
        schoolId: dto.schoolId,
        schoolYearId: dto.schoolYearId ?? null,
        format: analysis.format,
        totalRows: analysis.total,
        createdRows: created,
        duplicateRows: analysis.duplicates.length,
        errorRows: errors.length,
        report: {
          errors: errors.slice(0, REPORT_MAX),
          duplicates: analysis.duplicates.slice(0, REPORT_MAX),
        } as unknown as Prisma.InputJsonObject,
        createdByUserId: ctx.userId,
      },
      select: {
        id: true,
        format: true,
        totalRows: true,
        createdRows: true,
        duplicateRows: true,
        errorRows: true,
        report: true,
        createdAt: true,
      },
    });
    await this.school.log(ctx, 'school.students_imported', 'SchoolImportJob', job.id, {
      created,
      total: analysis.total,
    });
    return job;
  }

  async history(ctx: SchoolContext, schoolId: string) {
    await this.school.assertSchool(ctx, schoolId);
    return this.db.schoolImportJob.findMany({
      where: { organizationId: ctx.organizationId, schoolId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        format: true,
        totalRows: true,
        createdRows: true,
        duplicateRows: true,
        errorRows: true,
        report: true,
        createdAt: true,
      },
    });
  }

  private async importRow(
    tx: Prisma.TransactionClient,
    ctx: SchoolContext,
    dto: ImportDto,
    row: CleanRow,
    year: number,
  ) {
    const { line: _line, levelId, classId, guardian, ...identity } = row;
    await this.school.guardSchools(tx, [dto.schoolId]);
    const student = await this.students.createInTx(tx, ctx, {
      ...identity,
      schoolId: dto.schoolId,
      matriculeYearNumber: year,
    });
    if (guardian) {
      const known = await this.guardians.findReusable(tx, ctx, dto.schoolId, guardian);
      const guardianId =
        known?.id ??
        (await this.guardians.createWith(tx, ctx, { ...guardian, schoolId: dto.schoolId })).id;
      await this.guardians.linkInTx(tx, ctx, student.id, guardianId, {
        relation: 'LEGAL_GUARDIAN',
      });
    }
    if (levelId && dto.schoolYearId) {
      await this.enrollments.createInTx(tx, ctx, {
        studentId: student.id,
        schoolId: dto.schoolId,
        schoolYearId: dto.schoolYearId,
        levelId,
        classId: classId ?? undefined,
        status: 'PENDING',
      });
    }
  }

  private async analyze(
    ctx: SchoolContext,
    dto: ImportDto,
    file: Buffer | undefined,
  ): Promise<Analysis> {
    await this.school.assertSchool(ctx, dto.schoolId);
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choisissez un fichier.' });
    }
    if (file.length > SCHOOL_IMPORT_MAX_BYTES) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: 'Fichier trop lourd : 5 Mo au plus.',
      });
    }
    const sheet = await parseSheet(file);
    const mapping = this.readMapping(dto.mapping, sheet.headers);
    for (const required of ['lastName', 'firstName', 'birthDate'] as const) {
      if (!mapping[required]) {
        throw new BadRequestException({
          code: 'IMPORT_MAPPING_INCOMPLETE',
          message: 'Associez au moins les colonnes Nom, Prénom et Date de naissance.',
        });
      }
    }
    const org = ctx.organizationId;
    const settings = await this.students.readSettings(this.db, org, dto.schoolId);
    const scope = this.students.matriculeScopeKey(settings, dto.schoolId);
    if (dto.schoolYearId) {
      const year = await this.db.schoolYear.findFirst({
        where: { id: dto.schoolYearId, organizationId: org, schoolId: dto.schoolId },
        select: { status: true },
      });
      if (!year) throw new NotFoundException(NOT_FOUND);
      if (year.status === 'CLOSED') {
        throw new ConflictException({
          code: 'SCHOOL_YEAR_CLOSED',
          message: 'Cette année scolaire est clôturée.',
        });
      }
    }
    const [levels, classes] = await Promise.all([
      this.db.level.findMany({
        where: { organizationId: org, cycle: { schoolId: dto.schoolId } },
        select: { id: true, name: true, nameAr: true },
      }),
      dto.schoolYearId
        ? this.db.schoolClass.findMany({
            where: { organizationId: org, schoolYearId: dto.schoolYearId },
            select: { id: true, levelId: true, name: true, nameAr: true },
          })
        : Promise.resolve([]),
    ]);
    const byName = <T extends { name: string; nameAr: string | null }>(items: T[], name: string) =>
      items.filter(
        (i) =>
          normalizeSearch(i.name) === normalizeSearch(name) ||
          (i.nameAr !== null && normalizeSearch(i.nameAr) === normalizeSearch(name)),
      );

    const errors: LineIssue[] = [];
    const duplicates: LineIssue[] = [];
    const candidates: (CleanRow & { identityKey: string })[] = [];
    const seenIdentity = new Set<string>();
    const seenMatricule = new Set<string>();

    for (const { line, cells } of sheet.rows) {
      const read = (field: SchoolImportField) => {
        const header = mapping[field];
        return header ? (cells[header] ?? '').trim() : '';
      };
      const fail = (field: SchoolImportField, code: string, message: string) =>
        errors.push({ line, field, code, message });
      const before = errors.length;

      for (const [field, max] of IMPORT_LIMITS) {
        if (read(field).length > max) fail(field, 'VALUE_TOO_LONG', 'Valeur trop longue.');
      }
      const lastName = read('lastName');
      const firstName = read('firstName');
      if (!lastName || lastName.length > 120)
        fail('lastName', 'NAME_INVALID', 'Nom absent ou trop long.');
      if (!firstName || firstName.length > 120) {
        fail('firstName', 'NAME_INVALID', 'Prénom absent ou trop long.');
      }
      const birthDate = parseSchoolDate(read('birthDate'));
      if (!birthDate) fail('birthDate', 'DATE_INVALID', 'Date de naissance absente ou invalide.');
      const rawSex = read('sex');
      const sex = rawSex ? parseSchoolSex(rawSex) : null;
      if (rawSex && !sex) fail('sex', 'SEX_INVALID', 'Sexe non reconnu.');
      const matricule = read('matricule') || null;
      if (matricule && !isValidMatricule(matricule)) {
        fail('matricule', 'MATRICULE_INVALID', 'Matricule invalide.');
      }

      const className = read('class');
      const levelName = read('level');
      const classMatches = className ? byName(classes, className) : [];
      const cls = classMatches.length === 1 ? classMatches[0] : undefined;
      if (className && !dto.schoolYearId) {
        fail('class', 'YEAR_REQUIRED', 'Choisissez l’année scolaire pour importer les classes.');
      } else if (classMatches.length > 1) {
        fail('class', 'CLASS_AMBIGUOUS', 'Plusieurs classes portent ce nom.');
      } else if (className && !cls) {
        fail('class', 'CLASS_UNKNOWN', 'Classe inconnue pour cette année.');
      }
      const levelMatches = levelName ? byName(levels, levelName) : [];
      const level = levelMatches.length === 1 ? levelMatches[0] : undefined;
      if (levelMatches.length > 1)
        fail('level', 'LEVEL_AMBIGUOUS', 'Plusieurs niveaux portent ce nom.');
      else if (levelName && !level) fail('level', 'LEVEL_UNKNOWN', 'Niveau inconnu.');
      if (level && cls && cls.levelId !== level.id) {
        fail('class', 'CLASS_LEVEL_MISMATCH', 'La classe ne correspond pas au niveau.');
      }

      const guardianPhone = read('guardianPhone');
      const guardianLastName = read('guardianLastName');
      const guardianFirstName = read('guardianFirstName');
      const hasGuardian = Boolean(guardianPhone || guardianLastName || guardianFirstName);
      if (hasGuardian && !SCHOOL_PHONE.test(guardianPhone)) {
        fail('guardianPhone', 'PHONE_INVALID', 'Téléphone du responsable absent ou invalide.');
      }
      if (hasGuardian && (!guardianLastName || !guardianFirstName)) {
        fail('guardianLastName', 'GUARDIAN_INCOMPLETE', 'Nom et prénom du responsable requis.');
      }

      if (errors.length > before || !birthDate) continue;

      const identityKey = studentIdentityKey({ lastName, firstName }, birthDate);
      if (seenIdentity.has(identityKey) || (matricule && seenMatricule.has(matricule))) {
        duplicates.push({
          line,
          code: 'DUPLICATE_IN_FILE',
          message: 'Déjà présent dans le fichier.',
        });
        continue;
      }
      seenIdentity.add(identityKey);
      if (matricule) seenMatricule.add(matricule);
      candidates.push({
        identityKey,
        line,
        lastName,
        firstName,
        lastNameAr: read('lastNameAr') || null,
        firstNameAr: read('firstNameAr') || null,
        birthDate,
        birthPlace: read('birthPlace') || null,
        sex,
        nationality: read('nationality') || null,
        address: read('address') || null,
        matricule,
        levelId: cls?.levelId ?? level?.id ?? null,
        classId: cls?.id ?? null,
        guardian: hasGuardian
          ? { lastName: guardianLastName, firstName: guardianFirstName, phone: guardianPhone }
          : null,
      });
    }

    const existing = await this.db.schoolStudent.findMany({
      where: {
        organizationId: org,
        OR: [
          { identityKey: { in: candidates.map((c) => c.identityKey) } },
          {
            matriculeScope: scope,
            matricule: { in: candidates.flatMap((c) => (c.matricule ? [c.matricule] : [])) },
          },
        ],
      },
      select: { identityKey: true, schoolId: true, matricule: true, matriculeScope: true },
    });
    const identities = new Set(existing.map((e) => e.identityKey));
    const toReview = new Set(
      existing
        .filter((e) => this.students.needsGroupReview(ctx, dto.schoolId, [e]))
        .map((e) => e.identityKey),
    );
    const matricules = new Set(
      existing.filter((e) => e.matriculeScope === scope).map((e) => e.matricule),
    );
    const valid: CleanRow[] = [];
    for (const { identityKey, ...row } of candidates) {
      if (toReview.has(identityKey)) {
        errors.push({
          line: row.line,
          code: 'STUDENT_REVIEW_REQUIRED',
          message: STUDENT_REVIEW_MESSAGE,
        });
      } else if (identities.has(identityKey)) {
        duplicates.push({
          line: row.line,
          code: 'STUDENT_DUPLICATE',
          message: 'Dossier déjà existant.',
        });
      } else if (row.matricule && matricules.has(row.matricule)) {
        duplicates.push({
          line: row.line,
          code: 'MATRICULE_USED',
          message: 'Matricule déjà utilisé.',
        });
      } else {
        valid.push(row);
      }
    }
    if (toReview.size > 0) {
      await this.school.log(ctx, 'school.student_review_required', 'SchoolStudent', null, {
        schoolId: dto.schoolId,
        rows: toReview.size,
      });
    }
    return {
      format: sheet.format,
      headers: sheet.headers,
      mapping,
      total: sheet.rows.length,
      valid,
      duplicates,
      errors,
    };
  }

  private readMapping(raw: string | undefined, headers: string[]): SchoolImportMapping {
    if (!raw) return suggestImportMapping(headers);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new BadRequestException({
        code: 'IMPORT_MAPPING_INVALID',
        message: 'Correspondance des colonnes invalide.',
      });
    }
    const mapping: SchoolImportMapping = {};
    for (const [field, header] of Object.entries(parsed)) {
      if (typeof header === 'string' && headers.includes(header)) {
        mapping[field as SchoolImportField] = header;
      }
    }
    return mapping;
  }

  // ─── Export : colonnes limitées, jamais les besoins particuliers ni les observations ───

  async exportStudents(ctx: SchoolContext, q: ExportQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    const students = await this.db.schoolStudent.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: q.schoolId,
        ...(q.classId
          ? { enrollments: { some: { classId: q.classId, status: 'VALIDATED' } } }
          : {}),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        matricule: true,
        lastName: true,
        firstName: true,
        lastNameAr: true,
        firstNameAr: true,
        birthDate: true,
        status: true,
        enrollments: {
          where: {
            status: { in: ['DRAFT', 'PENDING', 'VALIDATED'] },
            year: { status: { not: 'CLOSED' } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            status: true,
            level: { select: { name: true } },
            class: { select: { name: true } },
          },
        },
      },
    });
    const table: TableExport = {
      headers: [
        'Matricule',
        'Nom',
        'Prénom',
        'Nom en arabe',
        'Prénom en arabe',
        'Date de naissance',
        'Niveau',
        'Classe',
        'Inscription',
        'Statut',
      ],
      rows: students.map((s) => {
        const e = s.enrollments[0];
        return [
          s.matricule,
          s.lastName,
          s.firstName,
          s.lastNameAr ?? '',
          s.firstNameAr ?? '',
          s.birthDate.toISOString().slice(0, 10),
          e?.level.name ?? '',
          e?.class?.name ?? '',
          e ? SCHOOL_ENROLLMENT_STATUS_LABELS[e.status] : '',
          SCHOOL_STUDENT_STATUS_LABELS[s.status],
        ];
      }),
    };
    await this.school.log(ctx, 'school.students_exported', 'School', q.schoolId, {
      rows: table.rows.length,
      ...(q.classId ? { classId: q.classId } : {}),
    });
    return this.file(table, q.format, q.classId ? 'liste-de-classe' : 'eleves');
  }

  async exportGuardians(ctx: SchoolContext, q: ExportQueryDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    const links = await this.db.schoolStudentGuardian.findMany({
      where: { organizationId: ctx.organizationId, student: { schoolId: q.schoolId } },
      orderBy: [{ student: { lastName: 'asc' } }],
      select: {
        relation: true,
        isPrimary: true,
        student: { select: { matricule: true } },
        guardian: { select: { lastName: true, firstName: true, phone: true, email: true } },
      },
    });
    const table: TableExport = {
      headers: ['Matricule', 'Nom', 'Prénom', 'Téléphone', 'E-mail', 'Lien', 'Principal'],
      rows: links.map((l) => [
        l.student.matricule,
        l.guardian.lastName,
        l.guardian.firstName,
        l.guardian.phone,
        l.guardian.email ?? '',
        l.relation,
        l.isPrimary ? 'Oui' : 'Non',
      ]),
    };
    await this.school.log(ctx, 'school.guardians_exported', 'School', q.schoolId, {
      rows: table.rows.length,
    });
    return this.file(table, q.format, 'responsables');
  }

  private async file(table: TableExport, format: 'csv' | 'xlsx' | undefined, name: string) {
    if (format === 'xlsx') {
      return {
        body: await toXlsx(table, name),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `${name}.xlsx`,
      };
    }
    return { body: toCsv(table), mimeType: 'text/csv; charset=utf-8', fileName: `${name}.csv` };
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body) return String(body.code);
  }
  return 'IMPORT_ROW_FAILED';
}
