import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import sharp from 'sharp';
import { emptySchoolSiteContent } from '@ocall/shared';
import { SchoolPrismaService } from '../src/modules/school/school-prisma.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  type Agent,
  type InternalAccount,
  PASSWORD,
  RUN,
  agent as anonymous,
  cleanup,
  createTestApp,
  email,
  internalAccount,
  login,
} from './helpers';

/**
 * Ocall School, Sprint 10 : sites vitrines publics des établissements. Activation, adresse unique,
 * brouillon et publication, actualités, réseaux sociaux, médias réencodés (EXIF/GPS supprimés),
 * attestation pour les photos de mineurs, retrait immédiat, maintien en lecture seule, résiliation,
 * export, isolation entre clients et permissions. Données fictives, bases de test locales jetables.
 */
const suite =
  (process.env.SCHOOL_TEST_DATABASE_URL ?? process.env.TEST_SCHOOL_DATABASE_URL)
    ? describe
    : describe.skip;

const TERMS = { startsOn: '2026-01-01', endsOn: '2099-12-31' };

interface Member {
  id: string;
  agent: Agent;
}

function binary(res: Response, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

/** Photo JPEG avec position GPS et appareil dans ses métadonnées EXIF. */
const photo = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2a6' } })
    .jpeg()
    .withMetadata({
      exif: {
        IFD0: { Make: 'TelephoneTest', Model: 'Modele-123' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 41/1 0/1' },
      },
    })
    .toBuffer();

suite('Ocall School — Sprint 10, sites vitrines (intégration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: SchoolPrismaService;
  let platform: InternalAccount;
  let ownerA: Agent;
  let ownerB: Agent;
  let schoolA: string;
  let schoolA2: string;
  let schoolB: string;
  let contractA: string;
  let secretary: Member;
  let teacher: Member;
  let directorA2: Member;
  let siteId: string;
  let slug: string;
  const organizations: string[] = [];
  const contracts = new Map<string, string>();
  let counter = 0;
  const pub = () => anonymous(app);

  async function connect(identifier: string, temporaryPassword: string): Promise<Agent> {
    const session = await login(app, identifier, temporaryPassword);
    expect(session.status).toBe(200);
    await session.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: temporaryPassword, newPassword: PASSWORD })
      .expect(204);
    return session.agent;
  }

  async function client(label: string): Promise<Agent> {
    const res = await platform.agent
      .post('/api/v1/platform/contracts/clients')
      .send({
        organizationName: `Test ${label} ${RUN}`,
        countryCode: 'SN',
        ownerFirstName: 'Mariama',
        ownerLastName: 'Sow',
        ownerEmail: email(`owner10-${label}`),
        reference: `OCS10-${RUN}-${++counter}`,
        ...TERMS,
      })
      .expect(201);
    organizations.push(res.body.contract.organizationId);
    contracts.set(label, res.body.contract.id);
    await contractStatus(res.body.contract.id, 'ACTIVE');
    return connect(res.body.loginId, res.body.temporaryPassword);
  }

  async function contractStatus(id: string, status: string) {
    await platform.agent
      .post(`/api/v1/platform/contracts/${id}/status`)
      .send({ status, reason: 'Décision de test' })
      .expect(200);
  }

  async function member(owner: Agent, role: string, schoolIds: string[]): Promise<Member> {
    const res = await owner
      .post('/api/v1/school/members')
      .send({ firstName: 'Ibrahima', lastName: `${role}${++counter}`, role, schoolIds })
      .expect(201);
    return {
      id: res.body.member.id,
      agent: await connect(res.body.member.loginId, res.body.temporaryPassword),
    };
  }

  async function school(owner: Agent, name: string, nameAr?: string): Promise<string> {
    const res = await owner
      .post('/api/v1/school/schools')
      .send({ name: `${name} ${RUN}`, nameAr, type: 'FRANCO_ARABIC', countryCode: 'SN' })
      .expect(201);
    return res.body.id as string;
  }

  const upload = (who: Agent, id: string, fields: Record<string, string>, file: Buffer) => {
    let req = who.post(`/api/v1/school/sites/${id}/media`);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, { filename: 'photo.jpg', contentType: 'image/jpeg' });
  };

  const publicSite = (s = slug) => pub().get(`/api/v1/public/school-sites/${s}`);

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    db = app.get(SchoolPrismaService);
    platform = await internalAccount(app, prisma, `sc10-owner-${RUN}`, 'PLATFORM_OWNER');
    ownerA = await client('a');
    ownerB = await client('b');
    contractA = contracts.get('a')!;
    schoolA = await school(ownerA, 'Medersa Annour', 'مدرسة النور');
    schoolA2 = await school(ownerA, 'Ecole Deux');
    schoolB = await school(ownerB, 'Ecole Autre');
    secretary = await member(ownerA, 'SECRETARY', [schoolA]);
    teacher = await member(ownerA, 'TEACHER', [schoolA]);
    directorA2 = await member(ownerA, 'SCHOOL_DIRECTOR', [schoolA2]);
    slug = `medersa-${RUN}`.toLowerCase();
  }, 300_000);

  afterAll(async () => {
    const where = { organizationId: { in: organizations } };
    await db.schoolSiteLink.deleteMany({ where });
    await db.schoolSiteNews.deleteMany({ where });
    await db.schoolSiteMedia.deleteMany({ where });
    await db.schoolSite.deleteMany({ where });
    await db.schoolMemberAssignment.deleteMany({ where });
    await db.schoolMember.deleteMany({ where });
    await db.school.deleteMany({ where });
    await db.schoolGroup.deleteMany({ where });
    await prisma.suiteContractEvent.deleteMany({
      where: { contract: { organizationId: { in: organizations } } },
    });
    await cleanup(prisma);
    await app.close();
  });

  describe('activation et adresse', () => {
    it('seule la direction active un site ; le secrétariat et l’enseignant sont refusés', async () => {
      await secretary.agent
        .post('/api/v1/school/sites')
        .send({ schoolId: schoolA, slug })
        .expect(403);
      await teacher.agent.get(`/api/v1/school/sites?schoolId=${schoolA}`).expect(403);
      const res = await ownerA
        .post('/api/v1/school/sites')
        .send({ schoolId: schoolA, slug })
        .expect(201);
      siteId = res.body.id;
      expect(res.body).toMatchObject({ slug, enabled: false, isOnline: false, status: 'DRAFT' });
      // Brouillon vide : aucune coordonnée de l'établissement reprise d'office.
      expect(res.body.draft).toEqual(emptySchoolSiteContent());
      expect(res.body.publicUrl).toBe(`http://localhost:3000/s/${slug}`);
    });

    it('adresse unique sur toute la plateforme, noms réservés et formats refusés', async () => {
      await ownerB.post('/api/v1/school/sites').send({ schoolId: schoolB, slug }).expect(409);
      await ownerA
        .post('/api/v1/school/sites')
        .send({ schoolId: schoolA, slug: 'autre-adresse' })
        .expect(409);
      for (const bad of ['www', 'ecole', 'api', 'a--b']) {
        await ownerB
          .post('/api/v1/school/sites')
          .send({ schoolId: schoolB, slug: bad })
          .expect(400);
      }
    });

    it('le site n’est pas public tant qu’il n’est ni activé ni publié', async () => {
      await ownerA.post(`/api/v1/school/sites/${siteId}/publish`).expect(409);
      const res = await publicSite().expect(200);
      expect(res.body).toEqual({
        state: 'UNAVAILABLE',
        name: { fr: `Medersa Annour ${RUN}`, ar: 'مدرسة النور' },
      });
      await pub().get('/api/v1/public/school-sites/inconnu-xyz').expect(404);
    });
  });

  describe('isolation entre établissements et entre clients', () => {
    it('un autre client, ou un directeur d’un autre établissement, ne voit rien (404)', async () => {
      for (const who of [ownerB, directorA2.agent]) {
        await who.get(`/api/v1/school/sites/${siteId}/preview`).expect(404);
        await who
          .put(`/api/v1/school/sites/${siteId}/draft`)
          .send({ content: emptySchoolSiteContent() })
          .expect(404);
        await who.get(`/api/v1/school/sites/${siteId}/media`).expect(404);
        await who.post(`/api/v1/school/sites/${siteId}/publish`).expect(404);
        await who.get(`/api/v1/school/sites/${siteId}/export`).expect(404);
      }
      await ownerB.get(`/api/v1/school/sites?schoolId=${schoolA}`).expect(404);
    });
  });

  describe('médias : réencodage, consentement, retrait', () => {
    let logoId: string;
    let childPhotoId: string;
    let childKey: string;

    it('image réencodée en WebP sans EXIF ni GPS ; SVG refusé', async () => {
      const res = await upload(
        secretary.agent,
        siteId,
        { kind: 'LOGO', alt: 'Logo', containsMinors: 'false' },
        await photo(),
      ).expect(201);
      logoId = res.body.id;
      expect(res.body).toMatchObject({ kind: 'LOGO', containsMinors: false, isPublished: false });
      const file = await secretary.agent.get(res.body.url).buffer(true).parse(binary).expect(200);
      expect(file.headers['content-type']).toBe('image/webp');
      const meta = await sharp(file.body as Buffer).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect((file.body as Buffer).toString('latin1')).not.toContain('TelephoneTest');
      await upload(
        secretary.agent,
        siteId,
        { kind: 'GALLERY', alt: 'Cour de récréation', containsMinors: 'false' },
        Buffer.from('<svg><script/></svg>'),
      ).expect(400);
    });

    it('photo avec des mineurs : référence d’autorisation obligatoire, attestation journalisée', async () => {
      const refused = await upload(
        secretary.agent,
        siteId,
        { kind: 'GALLERY', containsMinors: 'true' },
        await photo(),
      ).expect(400);
      expect(refused.body.code).toBe('MEDIA_CONSENT_REQUIRED');
      const res = await upload(
        secretary.agent,
        siteId,
        {
          kind: 'GALLERY',
          alt: 'Kermesse',
          containsMinors: 'true',
          consentReference: 'Registre 2026 n°12',
        },
        await photo(),
      ).expect(201);
      childPhotoId = res.body.id;
      expect(res.body).toMatchObject({
        containsMinors: true,
        consentReference: 'Registre 2026 n°12',
      });
      expect(res.body.consentAttestedAt).toEqual(expect.any(String));
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'school.site_media_consent_attested', targetId: childPhotoId },
      });
      expect(audit?.metadata).toMatchObject({ reference: 'Registre 2026 n°12' });
    });

    it('brouillon : contenu FR/AR enregistré, image étrangère refusée', async () => {
      const content = emptySchoolSiteContent();
      content.home.tagline = { fr: 'Apprendre ensemble', ar: 'نتعلم معا' };
      content.about.mission = { fr: 'Former des citoyens.', ar: '' };
      content.practical.phone = '+221 33 000 00 00';
      content.media.logoId = logoId;
      content.media.gallery = [{ mediaId: childPhotoId, caption: { fr: 'Kermesse', ar: 'الحفل' } }];
      await secretary.agent
        .put(`/api/v1/school/sites/${siteId}/draft`)
        .send({ content })
        .expect(200);
      const foreign = emptySchoolSiteContent();
      foreign.media.logoId = '00000000-0000-4000-8000-000000000000';
      const res = await secretary.agent
        .put(`/api/v1/school/sites/${siteId}/draft`)
        .send({ content: foreign })
        .expect(400);
      expect(res.body.code).toBe('SITE_MEDIA_UNKNOWN');
      const html = emptySchoolSiteContent() as unknown as Record<string, unknown>;
      html.grades = [];
      await secretary.agent
        .put(`/api/v1/school/sites/${siteId}/draft`)
        .send({ content: html })
        .expect(400);
    });

    it('publication par la direction seulement ; images publiées servies au public, les autres non', async () => {
      await secretary.agent
        .put(`/api/v1/school/sites/${siteId}/enabled`)
        .send({ enabled: true })
        .expect(403);
      await ownerA
        .put(`/api/v1/school/sites/${siteId}/enabled`)
        .send({ enabled: true })
        .expect(200);
      await secretary.agent.post(`/api/v1/school/sites/${siteId}/publish`).expect(403);
      const published = await ownerA.post(`/api/v1/school/sites/${siteId}/publish`).expect(200);
      expect(published.body).toMatchObject({ isOnline: true, status: 'PUBLISHED' });
      const res = await publicSite().expect(200);
      expect(res.body.state).toBe('PUBLISHED');
      expect(res.body.site.content.home.tagline).toEqual({
        fr: 'Apprendre ensemble',
        ar: 'نتعلم معا',
      });
      expect(res.body.site.name).toEqual({ fr: `Medersa Annour ${RUN}`, ar: 'مدرسة النور' });
      // Aucun identifiant interne dans la version publique.
      expect(JSON.stringify(res.body)).not.toContain(schoolA);
      expect(JSON.stringify(res.body)).not.toContain(siteId);
      expect(res.body.site.gallery).toHaveLength(1);
      childKey = res.body.site.gallery[0].url.split('/').pop();
      const img = await pub()
        .get(res.body.site.gallery[0].url)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(img.headers['cache-control']).toBe('public, max-age=300');
      expect(img.headers['x-content-type-options']).toBe('nosniff');
      // Un média non publié n'a aucune adresse publique.
      const unpublished = await upload(
        secretary.agent,
        siteId,
        { kind: 'GALLERY', alt: 'Cour de récréation', containsMinors: 'false' },
        await photo(),
      ).expect(201);
      const key = (unpublished.body.url as string).split('/').pop();
      await pub().get(`/api/v1/public/school-media/${key}`).expect(404);
      await pub().get('/api/v1/public/school-media/..%2F..%2Fetc%2Fpasswd').expect(404);
    });

    it('retrait immédiat d’une photo publiée : hors du site, fichiers supprimés, traçabilité', async () => {
      await secretary.agent
        .post(`/api/v1/school/sites/${siteId}/media/${childPhotoId}/withdraw`)
        .send({ reason: 'Demande de la famille' })
        .expect(200);
      const res = await publicSite().expect(200);
      expect(res.body.site.gallery).toEqual([]);
      await pub().get(`/api/v1/public/school-media/${childKey}`).expect(404);
      const row = await db.schoolSiteMedia.findUnique({ where: { id: childPhotoId } });
      expect(row).toMatchObject({
        storageKey: null,
        thumbKey: null,
        isPublished: false,
        withdrawalReason: 'Demande de la famille',
      });
      expect(row?.withdrawnAt).toBeInstanceOf(Date);
      const site = await ownerA.get(`/api/v1/school/sites?schoolId=${schoolA}`).expect(200);
      expect(site.body.draft.media.gallery).toEqual([]);
    });
  });

  describe('réseaux sociaux et liens externes', () => {
    it('https et domaine du réseau exigés ; WhatsApp international ; ordre et activation', async () => {
      const bad = [
        { kind: 'FACEBOOK', url: 'http://facebook.com/ecole' },
        { kind: 'INSTAGRAM', url: 'https://facebook.com/ecole' },
        { kind: 'OTHER', url: 'javascript:alert(1)', label: 'x' },
        { kind: 'OTHER', url: 'https://ministere.gouv.sn' },
        { kind: 'WHATSAPP', url: '77 000 00 00' },
      ];
      for (const b of bad)
        await secretary.agent.post(`/api/v1/school/sites/${siteId}/links`).send(b).expect(400);
      const fb = await secretary.agent
        .post(`/api/v1/school/sites/${siteId}/links`)
        .send({ kind: 'FACEBOOK', url: 'https://www.facebook.com/medersa' })
        .expect(201);
      const wa = await secretary.agent
        .post(`/api/v1/school/sites/${siteId}/links`)
        .send({ kind: 'WHATSAPP', url: '+221 77 000 00 00' })
        .expect(201);
      expect(wa.body.url).toBe('https://wa.me/221770000000');
      const yt = await secretary.agent
        .post(`/api/v1/school/sites/${siteId}/links`)
        .send({ kind: 'YOUTUBE', url: 'https://youtu.be/abc', enabled: false })
        .expect(201);
      const other = await secretary.agent
        .post(`/api/v1/school/sites/${siteId}/links`)
        .send({ kind: 'OTHER', url: 'https://ministere.gouv.sn', label: 'Ministère' })
        .expect(201);
      await secretary.agent
        .put(`/api/v1/school/sites/${siteId}/links-order`)
        .send({ ids: [wa.body.id, other.body.id, fb.body.id, yt.body.id] })
        .expect(200);
      await secretary.agent
        .put(`/api/v1/school/sites/${siteId}/links-order`)
        .send({ ids: [wa.body.id] })
        .expect(400);
      const res = await publicSite().expect(200);
      // Liens actifs seulement, dans l'ordre choisi ; bouton WhatsApp sur le numéro officiel.
      expect(res.body.links.map((l: { kind: string }) => l.kind)).toEqual([
        'WHATSAPP',
        'OTHER',
        'FACEBOOK',
      ]);
      expect(res.body.whatsapp).toBe('221770000000');
      await secretary.agent
        .patch(`/api/v1/school/sites/${siteId}/links/${wa.body.id}`)
        .send({ enabled: false })
        .expect(200);
      const after = await publicSite().expect(200);
      expect(after.body.whatsapp).toBeNull();
      await secretary.agent
        .delete(`/api/v1/school/sites/${siteId}/links/${other.body.id}`)
        .expect(200);
      await ownerB
        .post(`/api/v1/school/sites/${siteId}/links`)
        .send({ kind: 'FACEBOOK', url: 'https://facebook.com/x' })
        .expect(404);
    });
  });

  describe('actualités', () => {
    it('brouillon invisible ; publication par la direction ; adresse lisible et unique', async () => {
      const a = await secretary.agent
        .post(`/api/v1/school/sites/${siteId}/news`)
        .send({
          title: 'Rentrée scolaire',
          titleAr: 'الدخول المدرسي',
          body: 'Lundi 5 octobre.',
          publishedOn: '2026-10-01',
        })
        .expect(201);
      const b = await secretary.agent
        .post(`/api/v1/school/sites/${siteId}/news`)
        .send({ title: 'Rentrée scolaire', body: 'Deuxième annonce.', publishedOn: '2026-10-02' })
        .expect(201);
      expect([a.body.slug, b.body.slug]).toEqual(['rentree-scolaire', 'rentree-scolaire-2']);
      expect((await publicSite().expect(200)).body.news).toEqual([]);
      await secretary.agent
        .put(`/api/v1/school/sites/${siteId}/news/${a.body.id}/status`)
        .send({ publish: true })
        .expect(403);
      await ownerA
        .put(`/api/v1/school/sites/${siteId}/news/${a.body.id}/status`)
        .send({ publish: true })
        .expect(200);
      const res = await publicSite().expect(200);
      expect(res.body.news).toEqual([
        {
          slug: 'rentree-scolaire',
          title: { fr: 'Rentrée scolaire', ar: 'الدخول المدرسي' },
          body: { fr: 'Lundi 5 octobre.', ar: '' },
          publishedOn: '2026-10-01',
          image: null,
        },
      ]);
    });
  });

  describe('plan du site et dépublication', () => {
    it('dépublication : le site sort du public aussitôt, brouillon conservé ; republication', async () => {
      await ownerA.post(`/api/v1/school/sites/${siteId}/unpublish`).expect(200);
      expect((await publicSite().expect(200)).body.state).toBe('UNAVAILABLE');
      const kept = await ownerA.get(`/api/v1/school/sites?schoolId=${schoolA}`).expect(200);
      expect(kept.body.draft.home.tagline.fr).toBe('Apprendre ensemble');
      await ownerA.post(`/api/v1/school/sites/${siteId}/publish`).expect(200);
      expect((await publicSite().expect(200)).body.state).toBe('PUBLISHED');
    });
  });

  describe('corrections de l’audit (passe 1)', () => {
    it('image informative sans description refusée', async () => {
      const res = await upload(
        secretary.agent,
        siteId,
        { kind: 'GALLERY', containsMinors: 'false' },
        await photo(),
      ).expect(400);
      expect(res.body.code).toBe('MEDIA_ALT_REQUIRED');
    });

    it('actualité publiée : le secrétariat ne peut plus la modifier, la direction oui', async () => {
      const list = await secretary.agent.get(`/api/v1/school/sites/${siteId}/news`).expect(200);
      const published = list.body.find((n: { status: string }) => n.status === 'PUBLISHED');
      const draft = list.body.find((n: { status: string }) => n.status === 'DRAFT');
      const refused = await secretary.agent
        .patch(`/api/v1/school/sites/${siteId}/news/${published.id}`)
        .send({ body: 'Texte modifié sans validation.' })
        .expect(403);
      expect(refused.body.code).toBe('SITE_NEWS_PUBLISHED');
      await secretary.agent
        .patch(`/api/v1/school/sites/${siteId}/news/${draft.id}`)
        .send({ body: 'Brouillon modifiable.' })
        .expect(200);
      await ownerA
        .patch(`/api/v1/school/sites/${siteId}/news/${published.id}`)
        .send({ body: 'Lundi 5 octobre, 8 h.' })
        .expect(200);
      const site = await publicSite().expect(200);
      expect(site.body.news[0].body.fr).toBe('Lundi 5 octobre, 8 h.');
    });

    it('article publié résolu par son adresse ; brouillon introuvable ; lecture jamais mise en cache', async () => {
      const article = await pub()
        .get(`/api/v1/public/school-sites/${slug}/news/rentree-scolaire`)
        .expect(200);
      expect(article.body).toMatchObject({ slug: 'rentree-scolaire', publishedOn: '2026-10-01' });
      expect(article.headers['cache-control']).toBe('no-store');
      await pub().get(`/api/v1/public/school-sites/${slug}/news/rentree-scolaire-2`).expect(404);
      const site = await publicSite().expect(200);
      expect(site.headers['cache-control']).toBe('no-store');
    });

    it('plan du site de l’hôte de l’application : sites servis à l’adresse provisoire /s/<slug>', async () => {
      const res = await pub()
        .get('/api/v1/public/school-sites/sitemap?host=localhost:3000')
        .expect(200);
      const urls = res.body.map((e: { url: string }) => e.url);
      expect(urls).toContain(`http://localhost:3000/s/${slug}/a-propos`);
      expect(urls).toContain(`http://localhost:3000/s/${slug}/actualites/rentree-scolaire`);
      expect(urls).not.toContain(`http://localhost:3000/s/${slug}/actualites/rentree-scolaire-2`);
    });

    it('périmètre du contrat : un établissement retiré du contrat n’a plus de site public', async () => {
      await platform.agent
        .patch(`/api/v1/platform/contracts/${contractA}`)
        .send({ coveredSchoolIds: [schoolA2] })
        .expect(200);
      expect((await publicSite().expect(200)).body.state).toBe('UNAVAILABLE');
      await platform.agent
        .patch(`/api/v1/platform/contracts/${contractA}`)
        .send({ coveredSchoolIds: [] })
        .expect(200);
      expect((await publicSite().expect(200)).body.state).toBe('PUBLISHED');
    });
  });

  describe('contrat : maintien temporaire, résiliation, export', () => {
    it('suspendu : site maintenu en lecture seule, aucune publication, retrait et dépublication permis', async () => {
      await contractStatus(contractA, 'SUSPENDED');
      const res = await publicSite().expect(200);
      expect(res.body.state).toBe('PUBLISHED');
      expect(res.body.readOnlyUntil).toEqual(expect.any(String));
      const days = (Date.parse(res.body.readOnlyUntil) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThanOrEqual(30);
      await ownerA.post(`/api/v1/school/sites/${siteId}/publish`).expect(403);
      await ownerA
        .put(`/api/v1/school/sites/${siteId}/draft`)
        .send({ content: emptySchoolSiteContent() })
        .expect(403);
      const logo = (await ownerA.get(`/api/v1/school/sites/${siteId}/media`).expect(200)).body.find(
        (m: { kind: string }) => m.kind === 'LOGO',
      );
      await ownerA
        .post(`/api/v1/school/sites/${siteId}/media/${logo.id}/withdraw`)
        .send({})
        .expect(200);
      // Export toujours possible (consultation et export en lecture seule).
      const exported = await ownerA
        .get(`/api/v1/school/sites/${siteId}/export`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      const body = JSON.parse((exported.body as Buffer).toString('utf8'));
      expect(body).toMatchObject({ format: 'ocall-school-site/1', site: { slug } });
      expect(body.news).toHaveLength(2);
      expect(body.links.length).toBeGreaterThanOrEqual(3);
    });

    it('fin de la période de maintien : hors ligne', async () => {
      await prisma.suiteContractEvent.updateMany({
        where: { contractId: contractA, toStatus: 'SUSPENDED' },
        data: { createdAt: new Date(Date.now() - 31 * 86_400_000) },
      });
      expect((await publicSite().expect(200)).body.state).toBe('UNAVAILABLE');
    });

    it('réactivation : en ligne ; résiliation : hors ligne aussitôt, export encore disponible', async () => {
      await contractStatus(contractA, 'ACTIVE');
      expect((await publicSite().expect(200)).body.state).toBe('PUBLISHED');
      await contractStatus(contractA, 'TERMINATED');
      expect((await publicSite().expect(200)).body.state).toBe('UNAVAILABLE');
      await ownerA.get(`/api/v1/school/sites/${siteId}/export`).expect(200);
      await ownerA.post(`/api/v1/school/sites/${siteId}/publish`).expect(403);
    });
  });
});
