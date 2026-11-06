import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  SCHOOL_AI_LIMITS,
  SCHOOL_AI_SECTIONS,
  type SchoolAiContentKind,
  isLimitedToOwnClasses,
} from '@ocall/shared';
import type { Prisma } from '@ocall/school-database';
import type { JsonSchema } from '../../../ai-core/ai-provider';
import type { SchoolContext } from '../school-access';
import { SchoolPrismaService } from '../school-prisma.service';
import { SchoolService } from '../school.service';
import { renderTeachingDocument } from './school-ai-document.pdf';
import type {
  ContentListDto,
  GenerateContentDto,
  RegenerateSectionDto,
  UpdateContentDto,
} from './school-ai.dto';
import { SCHOOL_TEACHING_PROMPT, SCHOOL_TEACHING_SECTION_PROMPT } from './school-ai.prompts';
import { SchoolAiPrivacyService } from './school-ai-privacy.service';
import { SchoolAiService } from './school-ai.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };

/** Contenu pédagogique tel que renvoyé par l'API. */
export interface TeachingDocumentView {
  id: string;
  organizationId: string;
  schoolId: string;
  classId: string | null;
  levelId: string | null;
  subjectId: string;
  kind: string;
  language: string;
  difficulty: string;
  topic: string;
  objectives: string;
  title: string;
  sections: unknown;
  status: string;
  promptVersion: number;
  validatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentSection {
  key: string;
  heading: string;
  body: string;
}

const KIND_LABELS: Record<SchoolAiContentKind, string> = {
  LESSON_SHEET: 'fiche de cours',
  LESSON_PLAN: 'plan de leçon',
  EXERCISES: 'série d’exercices',
  QCM: 'questionnaire à choix multiples (QCM)',
  HOMEWORK: 'devoir à la maison',
  ANSWER_KEY: 'corrigé',
  ACTIVITY: 'activité pédagogique',
};
const DIFFICULTY_LABELS = { EASY: 'facile', MEDIUM: 'moyenne', HARD: 'difficile' } as const;

const DOCUMENT_SELECT = {
  id: true,
  organizationId: true,
  schoolId: true,
  classId: true,
  levelId: true,
  subjectId: true,
  kind: true,
  language: true,
  difficulty: true,
  topic: true,
  objectives: true,
  title: true,
  sections: true,
  status: true,
  promptVersion: true,
  validatedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function contentSchema(kind: SchoolAiContentKind): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'sections'],
    properties: {
      title: { type: 'string' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'heading', 'body'],
          properties: {
            key: { type: 'string', enum: [...SCHOOL_AI_SECTIONS[kind]] },
            heading: { type: 'string' },
            body: { type: 'string' },
          },
        },
      },
    },
  };
}

const SECTION_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['heading', 'body'],
  properties: { heading: { type: 'string' }, body: { type: 'string' } },
};

/**
 * Revalidation SERVEUR d'un contenu proposé par le modèle : seules les sections attendues, dans l'ordre
 * du type de contenu, textes bornés ; une section absente reste vide (signalée à l'enseignant).
 */
export function normalizeContent(
  kind: SchoolAiContentKind,
  raw: unknown,
): { title: string; sections: ContentSection[]; missing: string[] } {
  const value = (raw && typeof raw === 'object' ? raw : {}) as {
    title?: unknown;
    sections?: unknown;
  };
  const given = Array.isArray(value.sections) ? value.sections : [];
  const byKey = new Map<string, { heading?: unknown; body?: unknown }>();
  for (const s of given) {
    if (s && typeof s === 'object' && typeof (s as { key?: unknown }).key === 'string') {
      byKey.set((s as { key: string }).key, s as { heading?: unknown; body?: unknown });
    }
  }
  const missing: string[] = [];
  const sections = SCHOOL_AI_SECTIONS[kind].map((key) => {
    const s = byKey.get(key);
    const body =
      typeof s?.body === 'string' ? s.body.trim().slice(0, SCHOOL_AI_LIMITS.sectionMaxLength) : '';
    if (!body) missing.push(key);
    return {
      key,
      heading:
        typeof s?.heading === 'string' && s.heading.trim() ? s.heading.trim().slice(0, 120) : key,
      body,
    };
  });
  const title =
    typeof value.title === 'string' && value.title.trim()
      ? value.title.trim().slice(0, SCHOOL_AI_LIMITS.titleMaxLength)
      : KIND_LABELS[kind];
  return { title, sections, missing };
}

/**
 * Assistant pédagogique (Ocall School AI, module B) : fiches, plans, exercices, QCM, devoirs, corrigés,
 * activités. Contenu structuré et modifiable, section régénérable, enregistré comme brouillon de son
 * auteur ; seul l'auteur le valide (validation humaine obligatoire) avant tout export PDF ou diffusion.
 * L'enseignant n'opère que sur ses classes et matières (affectations actives). Aucune note ni évaluation
 * n'est lue ni modifiée ; aucun nom d'élève n'est transmis au fournisseur.
 */
@Injectable()
export class SchoolAiTeachingService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly ai: SchoolAiService,
    private readonly privacy: SchoolAiPrivacyService,
  ) {}

  async generate(
    ctx: SchoolContext,
    dto: GenerateContentDto,
  ): Promise<TeachingDocumentView & { missing: string[] }> {
    const school = await this.ai.scope(ctx, dto.schoolId);
    const target = await this.target(ctx, dto);
    // Avant tout appel au fournisseur : aucun élève ni responsable cité, coordonnées masquées.
    const [topic, objectives] = await this.privacy.protect(ctx, dto.schoolId, [
      dto.topic,
      dto.objectives,
    ]);
    // Les contenus archivés ne comptent pas : archiver libère une place.
    const count = await this.db.schoolAiDocument.count({
      where: {
        organizationId: ctx.organizationId,
        authorUserId: ctx.userId,
        status: { not: 'ARCHIVED' },
      },
    });
    if (count >= SCHOOL_AI_LIMITS.documentsPerUser) {
      throw new UnprocessableEntityException({
        code: 'AI_DOCUMENTS_LIMIT',
        message:
          'Vous avez atteint le nombre maximal de contenus en cours : archivez-en pour libérer des places.',
      });
    }
    const sections = SCHOOL_AI_SECTIONS[dto.kind];
    const raw = await this.ai.run(
      ctx,
      school,
      'SCHOOL_TEACHING',
      SCHOOL_TEACHING_PROMPT,
      (provider, model) =>
        provider.structureText<unknown>({
          model,
          instructions: SCHOOL_TEACHING_PROMPT.instructions,
          schemaName: 'school_teaching_content',
          schema: contentSchema(dto.kind),
          text: [
            `TYPE DE CONTENU : ${KIND_LABELS[dto.kind]} (${dto.kind})`,
            `LANGUE : ${dto.language === 'AR' ? 'arabe' : 'français'}`,
            `NIVEAU OU CLASSE : ${target.label}`,
            `MATIÈRE : ${target.subject}`,
            `DIFFICULTÉ : ${DIFFICULTY_LABELS[dto.difficulty]}`,
            `SECTIONS (clés, dans l’ordre) : ${sections.join(', ')}`,
            `SUJET (donnée saisie par l’enseignant) : ${topic}`,
            `OBJECTIFS (donnée saisie par l’enseignant) : ${objectives || 'non précisés'}`,
          ].join('\n'),
        }),
    );
    const content = normalizeContent(dto.kind, raw);
    const doc = await this.db.schoolAiDocument.create({
      data: {
        organizationId: ctx.organizationId,
        schoolId: school.id,
        authorUserId: ctx.userId,
        authorMemberId: ctx.memberId,
        classId: target.classId,
        levelId: target.levelId,
        subjectId: dto.subjectId,
        kind: dto.kind,
        language: dto.language,
        difficulty: dto.difficulty,
        topic: topic!,
        objectives: objectives!,
        title: content.title,
        sections: content.sections as object[],
        promptVersion: SCHOOL_TEACHING_PROMPT.version,
      },
      select: DOCUMENT_SELECT,
    });
    await this.school.log(ctx, 'school.ai_content_generated', 'SchoolAiDocument', doc.id, {
      kind: dto.kind,
      language: dto.language,
    });
    return { ...doc, missing: content.missing };
  }

  async list(ctx: SchoolContext, q: ContentListDto) {
    await this.school.assertSchool(ctx, q.schoolId);
    return this.db.schoolAiDocument.findMany({
      where: {
        organizationId: ctx.organizationId,
        schoolId: q.schoolId,
        authorUserId: ctx.userId,
        ...(q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } }),
      },
      orderBy: { updatedAt: 'desc' },
      // Jusqu'au plafond des contenus actifs : aucun contenu inaccessible depuis l'interface.
      take: SCHOOL_AI_LIMITS.documentsPerUser,
      select: {
        id: true,
        kind: true,
        language: true,
        title: true,
        topic: true,
        status: true,
        subjectId: true,
        classId: true,
        levelId: true,
        updatedAt: true,
      },
    });
  }

  async get(ctx: SchoolContext, id: string): Promise<TeachingDocumentView> {
    return this.own(ctx, id);
  }

  async update(
    ctx: SchoolContext,
    id: string,
    dto: UpdateContentDto,
  ): Promise<TeachingDocumentView> {
    const doc = await this.own(ctx, id);
    this.assertDraft(doc.status);
    this.assertVersion(doc, dto.version);
    // Clés imposées par le type de contenu, dans l'ordre : aucune clé libre (elle partirait au
    // fournisseur lors d'une régénération).
    const expected = SCHOOL_AI_SECTIONS[doc.kind as SchoolAiContentKind];
    const keys = dto.sections.map((s) => s.key);
    if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
      throw new BadRequestException({
        code: 'AI_SECTION_INVALID',
        message: `Sections attendues pour ce contenu : ${expected.join(', ')}.`,
      });
    }
    return this.writeDraft(doc, {
      title: dto.title,
      sections: dto.sections.map((s) => ({ ...s })),
    });
  }

  async regenerateSection(
    ctx: SchoolContext,
    id: string,
    key: string,
    dto: RegenerateSectionDto,
  ): Promise<TeachingDocumentView> {
    const doc = await this.own(ctx, id);
    this.assertDraft(doc.status);
    this.assertVersion(doc, dto.version);
    if (!SCHOOL_AI_SECTIONS[doc.kind as SchoolAiContentKind].includes(key)) {
      throw new NotFoundException(NOT_FOUND);
    }
    const sections = doc.sections as unknown as ContentSection[];
    const index = sections.findIndex((s) => s.key === key);
    if (index < 0) throw new NotFoundException(NOT_FOUND);
    const school = await this.ai.scope(ctx, doc.schoolId);
    // Droit de générer revérifié à chaque appel : classe, matière et, pour l'enseignant, affectation
    // active (consulter ses anciens contenus reste possible, les régénérer non).
    await this.target(ctx, {
      schoolId: doc.schoolId,
      classId: doc.classId ?? undefined,
      levelId: doc.classId ? undefined : (doc.levelId ?? undefined),
      subjectId: doc.subjectId,
    });
    // Le contenu envoyé comprend les textes saisis à la main : même contrôle que les autres entrées.
    const protectedTexts = await this.privacy.protect(ctx, doc.schoolId, [
      dto.instruction ?? '',
      doc.title,
      ...sections.flatMap((s) => [s.heading, s.body]),
    ]);
    const [instruction, title, ...flat] = protectedTexts;
    const safeSections = sections.map((s, i) => ({
      key: s.key,
      heading: flat[i * 2]!,
      body: flat[i * 2 + 1]!,
    }));
    const raw = await this.ai.run(
      ctx,
      school,
      'SCHOOL_TEACHING',
      SCHOOL_TEACHING_SECTION_PROMPT,
      (provider, model) =>
        provider.structureText<unknown>({
          model,
          instructions: SCHOOL_TEACHING_SECTION_PROMPT.instructions,
          schemaName: 'school_teaching_section',
          schema: SECTION_SCHEMA,
          text: [
            `LANGUE : ${doc.language === 'AR' ? 'arabe' : 'français'}`,
            `CONTENU ACTUEL (donnée, JSON) : ${JSON.stringify({ title, sections: safeSections })}`,
            `SECTION À RÉÉCRIRE : ${key}`,
            `CONSIGNE DE L’ENSEIGNANT (donnée) : ${instruction || 'aucune'}`,
          ].join('\n'),
        }),
    );
    const value = (raw && typeof raw === 'object' ? raw : {}) as {
      heading?: unknown;
      body?: unknown;
    };
    const body =
      typeof value.body === 'string'
        ? value.body.trim().slice(0, SCHOOL_AI_LIMITS.sectionMaxLength)
        : '';
    if (!body) {
      throw new UnprocessableEntityException({
        code: 'AI_INVALID_OUTPUT',
        message: 'La section proposée est vide : réessayez ou modifiez-la vous-même.',
      });
    }
    const next = sections.map((s, i) =>
      i === index
        ? {
            key,
            heading:
              typeof value.heading === 'string' && value.heading.trim()
                ? value.heading.trim().slice(0, 120)
                : s.heading,
            body,
          }
        : s,
    );
    // Écrit seulement si le brouillon n'a pas changé pendant l'appel (ni validé, ni modifié ailleurs).
    return this.writeDraft(doc, { sections: next.map((s) => ({ ...s })) });
  }

  /** Validation humaine par l'auteur : seule étape qui rend le contenu exportable ou diffusable. */
  async validate(ctx: SchoolContext, id: string, version: string): Promise<TeachingDocumentView> {
    const doc = await this.own(ctx, id);
    this.assertDraft(doc.status);
    // On valide la version relue par l'auteur : si elle a changé depuis, conflit.
    this.assertVersion(doc, version);
    const sections = doc.sections as unknown as ContentSection[];
    if (!sections.some((s) => s.body.trim())) {
      throw new UnprocessableEntityException({
        code: 'AI_DOCUMENT_EMPTY',
        message: 'Le contenu est vide : complétez-le avant de le valider.',
      });
    }
    const updated = await this.writeDraft(doc, {
      status: 'VALIDATED',
      validatedAt: new Date(),
      validatedByUserId: ctx.userId,
    });
    await this.school.log(ctx, 'school.ai_content_validated', 'SchoolAiDocument', doc.id, {
      kind: doc.kind,
    });
    return updated;
  }

  async archive(ctx: SchoolContext, id: string): Promise<TeachingDocumentView> {
    const doc = await this.own(ctx, id);
    return this.db.schoolAiDocument.update({
      where: { id: doc.id },
      data: { status: 'ARCHIVED' },
      select: DOCUMENT_SELECT,
    });
  }

  /** PDF d'un contenu VALIDÉ seulement : un brouillon n'est jamais diffusé. */
  async pdf(ctx: SchoolContext, id: string) {
    const doc = await this.own(ctx, id);
    if (doc.status !== 'VALIDATED') {
      throw new ConflictException({
        code: 'AI_DOCUMENT_NOT_VALIDATED',
        message: 'Validez le contenu avant de l’exporter : un brouillon n’est pas diffusable.',
      });
    }
    const [school, subject, cls, level] = await Promise.all([
      this.db.school.findUniqueOrThrow({
        where: { id: doc.schoolId },
        select: { name: true, nameAr: true },
      }),
      this.db.subject.findUniqueOrThrow({
        where: { id: doc.subjectId },
        select: { name: true, nameAr: true },
      }),
      doc.classId
        ? this.db.schoolClass.findUnique({
            where: { id: doc.classId },
            select: { name: true, nameAr: true },
          })
        : null,
      doc.levelId
        ? this.db.level.findUnique({
            where: { id: doc.levelId },
            select: { name: true, nameAr: true },
          })
        : null,
    ]);
    const arabic = doc.language === 'AR';
    const pick = (n: { name: string; nameAr: string | null } | null) =>
      n ? (arabic ? n.nameAr || n.name : n.name) : '';
    const file = await renderTeachingDocument({
      arabic,
      school: pick(school),
      title: doc.title,
      meta: [pick(subject), pick(cls ?? level), doc.topic].filter(Boolean),
      sections: doc.sections as unknown as ContentSection[],
    });
    await this.school.log(ctx, 'school.ai_content_exported', 'SchoolAiDocument', doc.id, {
      kind: doc.kind,
    });
    return { file, filename: `contenu-${doc.kind.toLowerCase()}-${doc.id.slice(0, 8)}.pdf` };
  }

  // ─── Outils ───

  /**
   * Écriture conditionnelle d'un brouillon : seulement s'il est encore brouillon et dans la version lue
   * (date de mise à jour). Sinon, conflit : rien n'est écrasé, aucun texte non validé ne se glisse dans
   * un contenu validé.
   */
  private async writeDraft(
    doc: TeachingDocumentView,
    data: Prisma.SchoolAiDocumentUpdateInput,
  ): Promise<TeachingDocumentView> {
    // Transaction courte (aucun appel IA dedans) : ligne verrouillée, état revérifié, puis la ligne
    // renvoyée est exactement celle que cette opération a écrite.
    return this.db.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string; updatedAt: Date }[]>`
        SELECT "status", "updatedAt" FROM "SchoolAiDocument"
        WHERE "id" = ${doc.id}::uuid AND "organizationId" = ${doc.organizationId}::uuid FOR UPDATE`;
      if (!row || row.status !== 'DRAFT' || row.updatedAt.getTime() !== doc.updatedAt.getTime()) {
        throw this.changed();
      }
      return tx.schoolAiDocument.update({ where: { id: doc.id }, data, select: DOCUMENT_SELECT });
    });
  }

  /** Version (date de mise à jour) relue par l'auteur : obligatoire, refus si elle a changé depuis. */
  private assertVersion(doc: TeachingDocumentView, version: string) {
    if (version !== doc.updatedAt.toISOString()) throw this.changed();
  }

  private changed() {
    return new ConflictException({
      code: 'AI_DOCUMENT_CHANGED',
      message:
        'Ce contenu a changé entre-temps (modifié, régénéré ou validé ailleurs) : rechargez-le avant de continuer.',
    });
  }

  private assertDraft(status: string) {
    if (status !== 'DRAFT') {
      throw new ConflictException({
        code: 'AI_DOCUMENT_NOT_DRAFT',
        message: 'Seul un brouillon se modifie : ce contenu est déjà validé ou archivé.',
      });
    }
  }

  /** Contenu de l'utilisateur, dans un établissement de son périmètre. */
  private async own(ctx: SchoolContext, id: string): Promise<TeachingDocumentView> {
    const doc = await this.db.schoolAiDocument.findFirst({
      where: { id, organizationId: ctx.organizationId, authorUserId: ctx.userId },
      select: DOCUMENT_SELECT,
    });
    if (!doc) throw new NotFoundException(NOT_FOUND);
    await this.school.assertSchool(ctx, doc.schoolId);
    return doc;
  }

  /**
   * Classe ou niveau et matière contrôlés : de l'établissement ; pour l'enseignant, une affectation
   * active sur cette matière dans cette classe (ou une classe de ce niveau).
   */
  private async target(
    ctx: SchoolContext,
    dto: Pick<GenerateContentDto, 'schoolId' | 'classId' | 'levelId' | 'subjectId'>,
  ) {
    if (!dto.classId && !dto.levelId) {
      throw new BadRequestException({
        code: 'AI_TARGET_REQUIRED',
        message: 'Choisissez une classe ou un niveau.',
      });
    }
    const subject = await this.db.subject.findFirst({
      where: {
        id: dto.subjectId,
        organizationId: ctx.organizationId,
        schoolId: dto.schoolId,
        isActive: true,
      },
      select: { name: true },
    });
    const cls = dto.classId
      ? await this.db.schoolClass.findFirst({
          where: {
            id: dto.classId,
            organizationId: ctx.organizationId,
            year: { schoolId: dto.schoolId },
          },
          select: { id: true, name: true, levelId: true },
        })
      : null;
    const level = dto.levelId
      ? await this.db.level.findFirst({
          where: {
            id: dto.levelId,
            organizationId: ctx.organizationId,
            cycle: { schoolId: dto.schoolId },
          },
          select: { id: true, name: true },
        })
      : null;
    if (!subject || (dto.classId && !cls) || (dto.levelId && !level)) {
      throw new NotFoundException(NOT_FOUND);
    }
    if (isLimitedToOwnClasses(ctx.role)) {
      const assigned = await this.db.schoolTeachingAssignment.count({
        where: {
          organizationId: ctx.organizationId,
          memberId: ctx.memberId ?? '00000000-0000-4000-8000-000000000000',
          subjectId: dto.subjectId,
          endedAt: null,
          class: cls ? { id: cls.id } : { levelId: level!.id, year: { schoolId: dto.schoolId } },
        },
      });
      if (assigned === 0) {
        throw new ForbiddenException({
          code: 'SCHOOL_FORBIDDEN',
          message: 'Vous ne pouvez préparer des contenus que pour vos classes et vos matières.',
        });
      }
    }
    return {
      classId: cls?.id ?? null,
      levelId: cls ? cls.levelId : (level?.id ?? null),
      label: cls?.name ?? level!.name,
      subject: subject.name,
    };
  }
}
