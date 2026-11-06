import { throttleTracker } from './visitor-throttler.guard';

/** Identité de limitation de débit : IP de la requête, ou visiteur transmis par le web authentifié. */
describe('limitation de débit : identité du visiteur', () => {
  const secret = 'secret-partage-de-test-1234567890';
  const req = (headers: Record<string, string>, url = '/api/v1/public/school-sites/annour') => ({
    ip: '10.0.0.5',
    method: 'GET',
    originalUrl: url,
    headers,
  });

  it('sans secret valide : l’IP de la requête (comportement inchangé)', () => {
    expect(throttleTracker(req({}), secret)).toBe('10.0.0.5');
    expect(
      throttleTracker(req({ 'x-ocall-internal': 'faux', 'x-ocall-visitor-ip': '1.2.3.4' }), secret),
    ).toBe('10.0.0.5');
    expect(
      throttleTracker(
        req({ 'x-ocall-internal': secret, 'x-ocall-visitor-ip': '1.2.3.4' }),
        undefined,
      ),
    ).toBe('10.0.0.5');
  });

  it('serveur web authentifié : un compteur par visiteur, jamais celui du serveur web', () => {
    expect(
      throttleTracker(
        req({ 'x-ocall-internal': secret, 'x-ocall-visitor-ip': '41.82.10.7' }),
        secret,
      ),
    ).toBe('visiteur:41.82.10.7');
    expect(
      throttleTracker(
        req({ 'x-ocall-internal': secret, 'x-ocall-visitor-ip': '2001:DB8::1' }),
        secret,
      ),
    ).toBe('visiteur:2001:db8::1');
  });

  it('autres routes (Park, administration) et écritures : jamais d’identité transmise', () => {
    const h = { 'x-ocall-internal': secret, 'x-ocall-visitor-ip': '41.82.10.7' };
    expect(throttleTracker(req(h, '/api/v1/public/sites/parc'), secret)).toBe('10.0.0.5');
    expect(throttleTracker(req(h, '/api/v1/school/sites'), secret)).toBe('10.0.0.5');
    expect(throttleTracker({ ...req(h), method: 'POST' }, secret)).toBe('10.0.0.5');
  });

  it('identité de visiteur invalide : ignorée', () => {
    expect(
      throttleTracker(
        req({ 'x-ocall-internal': secret, 'x-ocall-visitor-ip': '1.2.3.4; DROP' }),
        secret,
      ),
    ).toBe('10.0.0.5');
  });
});
