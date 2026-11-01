/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Données de démonstration Ocall Park (Sprint 13, P1-1) — base de PRÉPRODUCTION uniquement.
 *
 *   pnpm --filter @ocall/api build
 *   pnpm demo:seed:staging            # crée les trois démonstrations
 *   pnpm demo:seed:staging -- --reset # supprime puis recrée les démonstrations
 *
 * Trois organisations fictives (Parc, Restaurant, Parc + Restaurant), leurs employés, catalogue,
 * billets, commandes, stocks et abonnements, créés PAR L'API (application Nest démarrée en mémoire)
 * pour respecter toutes les règles métier (mots de passe hachés, QR, numérotation, stocks, quatre
 * yeux). Accès direct à la base seulement pour : les deux comptes internes de facturation (créés,
 * utilisés puis désactivés), l'antidatage de l'historique (statistiques) et la réinitialisation.
 *
 * Garde-fous : URL lues dans apps/api/.env.staging uniquement ; refus si la base est celle de
 * développement ou de test ; marqueurs : noms « (Démo) », e-mails @demo.ocall.invalid. Aucune
 * donnée réelle. Les mots de passe générés sont affichés une fois et écrits dans
 * apps/api/.env.demo-accounts (ignoré par Git).
 */
'use strict';
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { parse } = require('dotenv');

const API_DIR = resolve(__dirname, '..');
const DEMO_DOMAIN = '@demo.ocall.invalid';
const DEMO_SUFFIX = ' (Démo)';
const RESET = process.argv.includes('--reset');

// ─── Garde-fous : base de staging uniquement ───
const load = (f) =>
  existsSync(resolve(API_DIR, f)) ? parse(readFileSync(resolve(API_DIR, f))) : {};
const identity = (url) => {
  const u = new URL(url);
  return `${u.hostname.replace('-pooler.', '.')}/${u.pathname.slice(1)}`;
};
const masked = (url) => new URL(url).hostname.replace(/^(ep-[a-z]+-[a-z]+)-[a-z0-9]+/, '$1-***');
const staging = load('.env.staging');
const local = load('.env');
if (!staging.DATABASE_URL || !staging.DIRECT_URL) {
  console.error('apps/api/.env.staging doit définir DATABASE_URL et DIRECT_URL.');
  process.exit(1);
}
for (const [name, url] of [
  ['la base de développement', local.DATABASE_URL],
  ['la base de test', local.TEST_DATABASE_URL],
]) {
  if (url && identity(url) === identity(staging.DATABASE_URL)) {
    console.error(`Refus : la base cible est ${name}.`);
    process.exit(1);
  }
}
if (!existsSync(resolve(API_DIR, 'dist/app.module.js'))) {
  console.error('Compilez d’abord l’API : pnpm --filter @ocall/api build');
  process.exit(1);
}

// Environnement de l'application en mémoire : base de staging, aucun appel externe.
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_URL: staging.DATABASE_URL,
  DIRECT_URL: staging.DIRECT_URL,
  AI_PROVIDER: 'none',
  ONLINE_PAYMENT_PROVIDER: 'none',
  MEDIA_STORAGE: 'local',
  SITES_DOMAIN_VERIFIER: 'simulated',
  LOGIN_THROTTLE_LIMIT: '10000',
  PUBLIC_ORDER_THROTTLE_LIMIT: '10000',
  PUBLIC_LEAD_THROTTLE_LIMIT: '10000',
  SWAGGER_ENABLED: 'false',
  LOG_FORMAT: 'text',
  // Clé propre à cette exécution : seuls les comptes internes temporaires de la démo l'utilisent.
  MFA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  WEB_ORIGIN: local.WEB_ORIGIN || 'http://localhost:3000',
});

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { setupApp } = require('../dist/setup-app');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { currentStep, totpCode } = require('../dist/common/security/totp');
const { hash } = require('argon2');

const password = () => `Demo-${randomBytes(9).toString('base64url')}9a`;
const credentials = [];

/** Client HTTP minimal avec cookie de session. */
function client(base) {
  let cookie = '';
  async function call(method, path, body) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      throw new Error(
        `${method} ${path} → ${res.status} ${data?.code ?? ''} ${data?.message ?? ''}`.trim(),
      );
    }
    return data;
  }
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    put: (p, b = {}) => call('PUT', p, b),
    patch: (p, b = {}) => call('PATCH', p, b),
  };
}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  setupApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const prisma = app.get(PrismaService);
  console.log(`Base cible : ${masked(staging.DIRECT_URL)} (staging).`);

  try {
    const existing = await prisma.organization.count({
      where: { name: { endsWith: DEMO_SUFFIX } },
    });
    if (existing > 0 && !RESET) {
      throw new Error(
        `${existing} organisation(s) de démonstration existent déjà : relancez avec --reset.`,
      );
    }
    if (RESET) await resetDemo(prisma);

    const login = async (identifier, pwd) => {
      const c = client(base);
      await c.post('/auth/login', { identifier, password: pwd });
      return c;
    };

    /** Organisation de démonstration : inscription du propriétaire, puis connexion. */
    async function organization(key, name, businessType, establishmentName) {
      const email = `${key}.proprietaire${DEMO_DOMAIN}`;
      const pwd = password();
      const owner = client(base);
      await owner.post('/auth/signup', {
        organizationName: `${name}${DEMO_SUFFIX}`,
        businessType,
        countryCode: 'ML',
        establishmentName,
        firstName: 'Aminata',
        lastName: 'Démo',
        email,
        password: pwd,
      });
      credentials.push({
        organisation: name,
        rôle: 'Propriétaire',
        identifiant: email,
        motDePasse: pwd,
      });
      const [est] = await owner.get('/establishments');
      const me = await owner.get('/auth/me');
      return { owner, est: est.id, organizationId: me.organization.id, name };
    }

    /** Employé avec mot de passe de démonstration (le temporaire est remplacé). */
    async function employee(org, role, firstName) {
      const created = await org.owner.post('/employees', {
        firstName,
        lastName: 'Démo',
        role,
        establishmentIds: [org.est],
      });
      const pwd = password();
      const c = await login(created.employee.loginId, created.temporaryPassword);
      await c.post('/auth/change-password', {
        currentPassword: created.temporaryPassword,
        newPassword: pwd,
      });
      credentials.push({
        organisation: org.name,
        rôle: role,
        identifiant: created.employee.loginId,
        motDePasse: pwd,
      });
      return c;
    }

    async function restaurantCatalog(org) {
      const cats = {};
      for (const n of ['Plats', 'Boissons', 'Desserts']) {
        cats[n] = (await org.owner.post('/catalog/categories', { name: n })).id;
      }
      const product = async (cat, name, price) =>
        (
          await org.owner.post('/catalog/products', {
            name,
            categoryId: cats[cat],
            variants: [{ name: 'Standard', prices: [{ establishmentId: org.est, price }] }],
          })
        ).variants[0].id;
      const items = {
        poulet: await product('Plats', 'Poulet braisé', 4000),
        poisson: await product('Plats', 'Capitaine grillé', 5500),
        riz: await product('Plats', 'Riz gras', 2500),
        bissap: await product('Boissons', 'Jus de bissap', 1000),
        gingembre: await product('Boissons', 'Jus de gingembre', 1000),
        eau: await product('Boissons', 'Eau minérale', 500),
        degue: await product('Desserts', 'Dégué', 1500),
      };
      // Stocks et recette : le poulet braisé consomme un poulet entier.
      const chicken = (
        await org.owner.post('/stock/items', {
          establishmentId: org.est,
          name: 'Poulet entier',
          unit: 'UNIT',
          alertThreshold: 5,
        })
      ).id;
      await org.owner.post('/stock/movements', {
        stockItemId: chicken,
        kind: 'IN',
        quantity: 80,
        clientRequestId: randomUUID(),
      });
      await org.owner.put(`/stock/recipes/${items.poulet}`, {
        establishmentId: org.est,
        components: [{ stockItemId: chicken, quantity: 1 }],
      });
      const terrace = (
        await org.owner.post('/restaurant/zones', {
          establishmentId: org.est,
          name: 'Terrasse',
          kind: 'TERRACE',
        })
      ).id;
      const tables = [];
      for (let i = 1; i <= 6; i++) {
        tables.push(
          (
            await org.owner.post('/restaurant/tables', {
              establishmentId: org.est,
              zoneId: terrace,
              name: `Table ${i}`,
              seats: 4,
            })
          ).id,
        );
      }
      return { items, tables };
    }

    async function ticketCategories(org) {
      const category = async (body) =>
        (await org.owner.post('/ticketing/categories', { establishmentId: org.est, ...body })).id;
      return {
        adult: await category({ kind: 'ADULT', name: 'Adulte', price: 5000 }),
        child: await category({
          kind: 'CHILD',
          name: 'Enfant',
          price: 2500,
          conditions: 'Moins de 12 ans',
        }),
        family: await category({
          kind: 'FAMILY',
          name: 'Famille 4',
          price: 15000,
          peopleIncluded: 4,
        }),
      };
    }

    const pick = (arr, i) => arr[i % arr.length];
    // Une session de caisse par caissier (règle métier), même s'il vend billets et repas.
    const openSessions = new Set();
    const openCash = async (cashier, establishmentId) => {
      if (openSessions.has(cashier)) return;
      await cashier.post('/cash-sessions', { establishmentId, openingFloat: 20000 });
      openSessions.add(cashier);
    };
    const salesToBackdate = [];

    async function restaurantActivity(org, cashier, kitchen, catalog, count) {
      await openCash(cashier, org.est);
      const menu = Object.values(catalog.items);
      for (let i = 0; i < count; i++) {
        const lines = [
          { variantId: pick(menu, i), quantity: 1 + (i % 3) },
          { variantId: pick(menu, i + 3), quantity: 1 },
        ];
        const channel = pick(['DINE_IN', 'TAKEAWAY', 'COUNTER'], i);
        const order = await cashier.post('/orders', {
          establishmentId: org.est,
          channel,
          lines,
          ...(channel === 'DINE_IN' ? { tableId: pick(catalog.tables, i) } : {}),
        });
        await cashier.post(`/orders/${order.id}/send-to-kitchen`);
        if (i % 5 !== 4) {
          await kitchen.post(`/kitchen/orders/${order.id}/start`);
          await kitchen.post(`/kitchen/orders/${order.id}/ready`);
          await cashier.post(`/orders/${order.id}/serve`);
        }
        if (i % 7 !== 6) {
          await cashier.post(`/sales/${order.id}/payments`, {
            method: 'CASH',
            amountTendered: order.total,
            clientRequestId: randomUUID(),
          });
        }
        salesToBackdate.push(order.id);
      }
    }

    async function ticketActivity(org, cashier, gate, cats, count) {
      await openCash(cashier, org.est);
      let refusedShown = false;
      for (let i = 0; i < count; i++) {
        const names = ['Awa', 'Moussa', 'Fanta', 'Issa', 'Mariam', 'Sidi', 'Kadi', 'Bouba'];
        // Un prénom par billet émis (un billet famille couvre plusieurs personnes).
        const line = (ticketCategoryId, quantity, people = 1) => ({
          ticketCategoryId,
          quantity,
          visitorNames: Array.from({ length: quantity * people }, (_, k) => pick(names, i + k)),
        });
        const lines = [
          line(cats.adult, 1 + (i % 2)),
          ...(i % 3 === 0 ? [line(cats.child, 2)] : []),
          ...(i % 8 === 0 ? [line(cats.family, 1, 4)] : []),
        ];
        const sale = await cashier.post('/ticketing/orders', {
          establishmentId: org.est,
          lines,
          clientRequestId: randomUUID(),
        });
        await cashier.post(`/sales/${sale.id}/payments`, {
          method: 'CASH',
          amountTendered: sale.total,
          clientRequestId: randomUUID(),
        });
        const tickets = await cashier.get(`/tickets?saleId=${sale.id}`);
        // Les ventes du jour : billets scannés à l'entrée ; un second passage refusé pour la démo.
        if (i >= count - 6) {
          for (const t of tickets) {
            await gate.post('/access/scans', {
              establishmentId: org.est,
              entryPoint: 'Entrée principale',
              qr: t.qr,
              clientRequestId: randomUUID(),
            });
          }
          if (!refusedShown && tickets[0]) {
            await gate.post('/access/scans', {
              establishmentId: org.est,
              entryPoint: 'Entrée principale',
              qr: tickets[0].qr,
              clientRequestId: randomUUID(),
            });
            refusedShown = true;
          }
        } else {
          salesToBackdate.push(sale.id);
        }
      }
    }

    // ─── Organisations ───
    console.log('Création des organisations de démonstration…');
    const park = await organization('aqua', 'Aqua Parc', 'PARK', 'Aqua Parc — Bamako');
    const resto = await organization('maquis', 'Le Maquis', 'RESTAURANT', 'Le Maquis — ACI 2000');
    const combo = await organization(
      'oasis',
      'Oasis Loisirs',
      'PARK_RESTAURANT',
      'Oasis Loisirs — Kalaban',
    );

    console.log('Employés, catalogues, billets…');
    const parkCashier = await employee(park, 'CASHIER', 'Moussa');
    const parkGate = await employee(park, 'GATE_AGENT', 'Ibrahim');
    await employee(park, 'SUPERVISOR', 'Kadiatou');
    const parkCats = await ticketCategories(park);

    const restoCashier = await employee(resto, 'CASHIER', 'Fatoumata');
    const restoKitchen = await employee(resto, 'KITCHEN', 'Seydou');
    await employee(resto, 'SUPERVISOR', 'Mariam');
    const restoCatalog = await restaurantCatalog(resto);

    const comboCashier = await employee(combo, 'CASHIER', 'Oumar');
    const comboKitchen = await employee(combo, 'KITCHEN', 'Awa');
    const comboGate = await employee(combo, 'GATE_AGENT', 'Bakary');
    const comboCats = await ticketCategories(combo);
    const comboCatalog = await restaurantCatalog(combo);

    console.log('Activité : ventes de billets, scans, commandes, cuisine…');
    await ticketActivity(park, parkCashier, parkGate, parkCats, 40);
    await restaurantActivity(resto, restoCashier, restoKitchen, restoCatalog, 45);
    await ticketActivity(combo, comboCashier, comboGate, comboCats, 20);
    await restaurantActivity(combo, comboCashier, comboKitchen, comboCatalog, 20);

    // Historique : ventes réparties sur les 30 derniers jours (heures d'ouverture), pour des
    // statistiques représentatives. Paiements et billets suivent la date de leur vente.
    console.log('Antidatage de l’historique sur 30 jours…');
    for (let i = 0; i < salesToBackdate.length; i++) {
      const id = salesToBackdate[i];
      const daysAgo = 1 + (i % 29);
      const at = new Date(Date.now() - daysAgo * 86_400_000);
      at.setUTCHours(10 + (i % 9), (i * 7) % 60, 0, 0);
      await prisma.sale.update({ where: { id }, data: { createdAt: at } });
      await prisma.payment.updateMany({
        where: { saleId: id },
        data: { createdAt: new Date(at.getTime() + 5 * 60_000) },
      });
      await prisma.ticket.updateMany({ where: { saleId: id }, data: { createdAt: at } });
    }

    // ─── Abonnements : factures, règlements à quatre yeux, activation ───
    console.log('Abonnements : factures, règlements, activations…');
    const internal = async (label) => {
      const email = `facturation.${label}${DEMO_DOMAIN}`;
      const pwd = password();
      const user = await prisma.user.create({
        data: {
          email,
          loginId: email,
          firstName: 'Facturation',
          lastName: `Démo ${label}`,
          platformRole: 'BILLING_MANAGER',
          mustChangePassword: false,
          passwordHash: await hash(pwd, { type: 2 }),
        },
        select: { id: true },
      });
      const c = await login(email, pwd);
      const setup = await c.post('/auth/mfa/setup');
      await c.post('/auth/mfa/enable', { code: totpCode(setup.secret, currentStep()) });
      return { c, id: user.id };
    };
    const billingA = await internal('a');
    const billingB = await internal('b');
    const today = new Date().toISOString().slice(0, 10);
    const inAMonth = new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10);
    for (const [org, activate] of [
      [park, true],
      [resto, true],
      [combo, false],
    ]) {
      const sub = await prisma.subscription.findFirstOrThrow({
        where: { organizationId: org.organizationId },
      });
      const invoice = await billingA.c.post('/platform/invoices', {
        subscriptionId: sub.id,
        lines: [{ kind: 'SETUP' }, { kind: 'MONTHLY', months: 1 }],
        idempotencyKey: randomUUID(),
      });
      if (!activate) continue; // Oasis : facture émise, en attente de règlement (parcours à montrer).
      const payment = await billingA.c.post('/platform/subscription-payments', {
        organizationId: org.organizationId,
        invoiceId: invoice.id,
        amount: invoice.total,
        currency: 'XOF',
        method: 'MANUAL_TRANSFER',
        reference: `VIR-DEMO-${org.name.slice(0, 4).toUpperCase()}`,
        paidAt: today,
        periodStart: today,
        periodEnd: inAMonth,
      });
      await billingB.c.post(`/platform/subscription-payments/${payment.id}/confirm`);
      await billingA.c.post(`/platform/subscription-payments/${payment.id}/approve-activation`);
    }
    // Comptes internes temporaires : désactivés (leurs sessions aussi).
    await prisma.user.updateMany({
      where: { id: { in: [billingA.id, billingB.id] } },
      data: { isActive: false },
    });
    await prisma.session.updateMany({
      where: { userId: { in: [billingA.id, billingB.id] }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // ─── Identifiants ───
    const out = resolve(API_DIR, '.env.demo-accounts');
    writeFileSync(
      out,
      '# Comptes de démonstration (staging) — jamais commités. Régénérés à chaque --reset.\n' +
        credentials
          .map((c) => `# ${c.organisation} · ${c.rôle} · ${c.identifiant} · ${c.motDePasse}`)
          .join('\n') +
        '\n',
    );
    console.log(
      '\nComptes de démonstration (affichés une fois, copiés dans apps/api/.env.demo-accounts) :',
    );
    console.table(credentials);
    console.log('Démonstrations prêtes.');
  } finally {
    await app.close();
  }
}

/** Réinitialisation : supprime uniquement les organisations et comptes de démonstration. */
async function resetDemo(prisma) {
  const orgs = await prisma.organization.findMany({
    where: { name: { endsWith: DEMO_SUFFIX } },
    select: { id: true },
  });
  const orgIds = orgs.map((o) => o.id);
  const users = await prisma.user.findMany({
    where: { email: { endsWith: DEMO_DOMAIN } },
    select: { id: true },
  });
  const members = await prisma.organizationMembership.findMany({
    where: { organizationId: { in: orgIds } },
    select: { userId: true },
  });
  const userIds = [...new Set([...users.map((u) => u.id), ...members.map((m) => m.userId)])];
  await prisma.auditLog.deleteMany({
    where: { OR: [{ organizationId: { in: orgIds } }, { actorUserId: { in: userIds } }] },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  console.log(
    `Réinitialisation : ${orgIds.length} organisation(s) et ${userIds.length} compte(s) de démonstration supprimés.`,
  );
}

main().catch((e) => {
  console.error('Échec :', e instanceof Error ? e.message : e);
  process.exit(1);
});
