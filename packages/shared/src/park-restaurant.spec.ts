import {
  bestAccess,
  commercialAppCode,
  commercialAppName,
  productsForBusinessType,
  subscriptionActivities,
} from './park-restaurant';
import { defaultSwitchSplit, isValidSwitchSplit } from './site-billing';

describe('Ocall Suite sprint 7 — séparation Ocall Parc / Ocall Restaurant', () => {
  it('droits par activité : Parc, Restaurant, contrat combiné (les deux), offre combinée historique', () => {
    expect(subscriptionActivities('OCALL_PARK', false)).toEqual(['PARK']);
    expect(subscriptionActivities('OCALL_RESTAURANT', false)).toEqual(['RESTAURANT']);
    expect(subscriptionActivities('OCALL_PARK', true)).toEqual(['PARK', 'RESTAURANT']);
    expect(subscriptionActivities('OCALL_RESTAURANT', true)).toEqual(['PARK', 'RESTAURANT']);
    expect(subscriptionActivities('OCALL_PARK_RESTAURANT', false)).toEqual(['PARK', 'RESTAURANT']);
    expect(subscriptionActivities('OCALL_STOCK', true)).toEqual([]);
  });

  it('inscription : une application par activité du métier', () => {
    expect(productsForBusinessType('PARK')).toEqual(['OCALL_PARK']);
    expect(productsForBusinessType('RESTAURANT')).toEqual(['OCALL_RESTAURANT']);
    expect(productsForBusinessType('PARK_RESTAURANT')).toEqual(['OCALL_PARK', 'OCALL_RESTAURANT']);
    expect(productsForBusinessType('NONE')).toEqual([]);
  });

  it('meilleur droit parmi les abonnements couvrant une activité', () => {
    expect(bestAccess(['read_only', 'full'])).toBe('full');
    expect(bestAccess(['read_only', 'none'])).toBe('read_only');
    expect(bestAccess([])).toBe('none');
  });

  it('bascule : montant total conservé, répartition explicite validée', () => {
    const split = defaultSwitchSplit(50_000, 1, 1);
    expect(split).toEqual({ park: 25_000, restaurant: 25_000 });
    expect(split.park + split.restaurant).toBe(50_000);
    expect(defaultSwitchSplit(65_000, 3, 0)).toEqual({ park: 42_250, restaurant: 22_750 });
    expect(isValidSwitchSplit(50_000, { park: 30_000, restaurant: 20_000 })).toBe(true);
    expect(isValidSwitchSplit(50_000, { park: 30_000, restaurant: 20_001 })).toBe(false);
    expect(isValidSwitchSplit(50_000, { park: -1, restaurant: 50_001 })).toBe(false);
    expect(isValidSwitchSplit(50_000, { park: 25_000.5, restaurant: 24_999.5 })).toBe(false);
  });

  it('noms et applications du portail', () => {
    expect(commercialAppName('OCALL_RESTAURANT', 'Ocall Restaurant')).toBe('Ocall Restaurant');
    expect(commercialAppName('OCALL_PARK_RESTAURANT', 'Ocall Park + Restaurant')).toBe(
      'Ocall Park',
    );
    expect(commercialAppName('OCALL_STOCK', 'Ocall Stock')).toBe('Ocall Stock');
    expect(commercialAppCode('OCALL_PARK_RESTAURANT')).toBe('OCALL_PARK');
    expect(commercialAppCode('OCALL_RESTAURANT')).toBe('OCALL_RESTAURANT');
  });
});
