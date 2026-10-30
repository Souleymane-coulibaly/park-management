import {
  detectAudioMimeType,
  detectImportMimeType,
  estimateAiCostMicroUsd,
  extractNumbers,
  hasPermission,
  isPotentialDuplicate,
  matchProductName,
  microUsdToXof,
  navigationFor,
  normalizeLabel,
  numbersAreGrounded,
  resolveCopilotPeriod,
} from './index';

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('IA — formats de fichiers (signature, pas extension)', () => {
  it('reconnaît JPEG, PNG, WebP et PDF ; refuse le reste', () => {
    expect(detectImportMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectImportMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    );
    expect(detectImportMimeType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe(
      'image/webp',
    );
    expect(detectImportMimeType(bytes(...ascii('%PDF-1.7')))).toBe('application/pdf');
    expect(detectImportMimeType(bytes(...ascii('<html>')))).toBeNull();
    expect(detectImportMimeType(bytes(...ascii('PK')))).toBeNull();
    // Un WAV n'est pas une image WebP, même si les deux commencent par RIFF.
    expect(detectImportMimeType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBeNull();
  });

  it('reconnaît les enregistrements vocaux courants', () => {
    expect(detectAudioMimeType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('audio/webm');
    expect(detectAudioMimeType(bytes(...ascii('OggS')))).toBe('audio/ogg');
    expect(detectAudioMimeType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBe(
      'audio/wav',
    );
    expect(detectAudioMimeType(bytes(0, 0, 0, 0x20, ...ascii('ftyp')))).toBe('audio/mp4');
    expect(detectAudioMimeType(bytes(...ascii('ID3')))).toBe('audio/mpeg');
    expect(detectAudioMimeType(bytes(...ascii('%PDF-')))).toBeNull();
  });
});

describe('IA — périodes du copilote (fuseau de l’établissement)', () => {
  // Vendredi 30 octobre 2026, 23 h 30 à Bamako (UTC+0).
  const now = new Date('2026-10-30T23:30:00Z');

  it('calcule les bornes et un libellé lisible', () => {
    expect(resolveCopilotPeriod('today', now, 'Africa/Bamako')).toMatchObject({
      from: '2026-10-30',
      to: '2026-10-31',
      label: "Aujourd'hui (30/10/2026)",
    });
    expect(resolveCopilotPeriod('yesterday', now, 'Africa/Bamako')).toMatchObject({
      from: '2026-10-29',
      to: '2026-10-30',
    });
    expect(resolveCopilotPeriod('this_week', now, 'Africa/Bamako')).toMatchObject({
      from: '2026-10-26',
      to: '2026-10-31',
      label: 'Cette semaine, du 26/10/2026 au 30/10/2026',
    });
    expect(resolveCopilotPeriod('last_7_days', now, 'Africa/Bamako').from).toBe('2026-10-24');
    expect(resolveCopilotPeriod('this_month', now, 'Africa/Bamako').from).toBe('2026-10-01');
    expect(resolveCopilotPeriod('last_30_days', now, 'Africa/Bamako').from).toBe('2026-10-01');
  });

  it('dépend du fuseau : à Paris il est déjà le 31', () => {
    expect(resolveCopilotPeriod('today', now, 'Europe/Paris').from).toBe('2026-10-31');
  });
});

describe('IA — coûts estimés', () => {
  it('calcule en micro-dollars à partir des jetons, cache compris', () => {
    // 10 000 jetons dont 4 000 en cache, 1 000 en sortie, gpt-5 (1,25 / 0,125 / 10 $ par million).
    expect(
      estimateAiCostMicroUsd('gpt-5', {
        inputTokens: 10_000,
        cachedInputTokens: 4_000,
        outputTokens: 1_000,
      }),
    ).toBe(6_000 * 1.25 + 4_000 * 0.125 + 1_000 * 10);
  });

  it('calcule la transcription à la minute', () => {
    expect(estimateAiCostMicroUsd('gpt-4o-transcribe', { audioSeconds: 30 })).toBe(3_000);
  });

  it('modèle inconnu : coût non estimé (null), jamais zéro', () => {
    expect(estimateAiCostMicroUsd('modele-inconnu', { inputTokens: 100 })).toBeNull();
  });

  it('convertit en FCFA de façon indicative', () => {
    expect(microUsdToXof(1_000_000, 600)).toBe(600);
  });
});

describe('IA — doublons potentiels', () => {
  it('ignore accents, casse et ponctuation', () => {
    expect(normalizeLabel('  Poulet BRAISÉ !')).toBe('poulet braise');
    expect(isPotentialDuplicate('Poulet braisé', 'poulet braise')).toBe(true);
    expect(isPotentialDuplicate('Jus de bissap', 'Jus de bissap glacé')).toBe(true);
  });

  it('ne rapproche pas des produits différents', () => {
    expect(isPotentialDuplicate('Riz au poisson', 'Riz au poulet')).toBe(false);
    expect(isPotentialDuplicate('Thé', 'Thé glacé à la menthe')).toBe(false);
  });
});

describe('IA — chiffres cités par le copilote', () => {
  it('extrait les nombres écrits à la française', () => {
    expect(extractNumbers('12 500 FCFA pour 3,5 commandes et 1.250 billets')).toEqual([
      12500, 3.5, 1250,
    ]);
  });

  it('accepte une réponse fondée sur les données, refuse un chiffre inventé', () => {
    const data = '{"revenue":12500,"sales":4,"label":"Aujourd\'hui (30/10/2026)"}';
    expect(numbersAreGrounded('Aujourd’hui (30/10/2026) : 12 500 FCFA en 4 ventes.', data)).toBe(
      true,
    );
    expect(numbersAreGrounded('Vous avez fait 15 000 FCFA.', data)).toBe(false);
  });
});

describe('IA — droits', () => {
  it('copilote : responsables et superviseur ; configuration : propriétaire et administrateur', () => {
    expect(hasPermission('SUPERVISOR', 'ai.copilot')).toBe(true);
    expect(hasPermission('CASHIER', 'ai.copilot')).toBe(false);
    expect(hasPermission('SUPERVISOR', 'ai.manage')).toBe(false);
    expect(hasPermission('ADMIN', 'ai.manage')).toBe(true);
    expect(navigationFor('RESTAURANT', 'CASHIER').map((m) => m.key)).not.toContain('copilot');
  });
});

describe('Copilote — produit cité dans une question', () => {
  const items = [
    { id: 'p1', name: 'Poulet braisé' },
    { id: 'p2', name: 'Poulet yassa' },
    { id: 'p3', name: 'Jus de bissap' },
  ];
  it('identique au singulier et sans accents', () => {
    expect(matchProductName('poulets braises', items)).toEqual({
      status: 'MATCHED',
      item: items[0],
    });
    expect(matchProductName('jus bissap', items)).toEqual({ status: 'MATCHED', item: items[2] });
  });
  it('ambigu ou introuvable : jamais deviné', () => {
    expect(matchProductName('poulet', items)).toMatchObject({ status: 'AMBIGUOUS' });
    expect(matchProductName('pizza', items)).toEqual({ status: 'NOT_FOUND' });
    expect(matchProductName('  ', items)).toEqual({ status: 'NOT_FOUND' });
  });
});
