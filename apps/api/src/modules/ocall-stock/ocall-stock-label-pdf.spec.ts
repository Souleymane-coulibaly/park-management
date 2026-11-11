import { readFileSync } from 'node:fs';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { gtinCheckDigit, gtinEquivalents, stockInternalCode } from '@ocall/shared';
import {
  type LabelContent,
  renderBarcodePng,
  renderLabelsPdf,
  renderQrPng,
  symbologyFor,
} from './ocall-stock-label-pdf';

/**
 * Étiquettes : chaque code imprimé est RELU par un décodeur indépendant (zxing, chargé depuis le paquet,
 * sans réseau) et doit redonner exactement le code de l'article.
 */
beforeAll(async () => {
  await prepareZXingModule({
    overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) },
    fireImmediately: true,
  });
});

async function decode(
  png: Buffer,
  formats?: ('EAN-13' | 'EAN-8' | 'UPC-A')[],
): Promise<{ text: string; format: string }[]> {
  const results = await readBarcodes(new Uint8Array(png), {
    tryHarder: true,
    maxNumberOfSymbols: 1,
    ...(formats ? { formats } : {}),
  });
  return results.filter((r) => r.isValid).map((r) => ({ text: r.text, format: r.format }));
}

describe('Ocall Stock — codes-barres des étiquettes', () => {
  const ean13 = '4006381333931';
  const ean8 = '96385074';
  const upca = '036000291452';

  it.each([
    ['EAN13', ean13, 'EAN-13'],
    ['EAN8', ean8, 'EAN-8'],
    ['UPCA', upca, 'UPC-A'],
  ] as const)('%s imprimé puis relu à l’identique', async (type, code, format) => {
    // Décodeur limité au format attendu. Un UPC-A est relu sous sa forme EAN-13 (« 0 » + code), comme le
    // transmettent beaucoup de lecteurs : Ocall Stock tient les deux écritures pour équivalentes.
    const [read] = await decode(await renderBarcodePng(symbologyFor(type), code), [format]);
    expect(read?.format).toBe(format);
    expect(gtinEquivalents(read!.text)).toContain(code);
    if (type !== 'UPCA') expect(read?.text).toBe(code);
  });

  it('code interne et référence en Code 128, relus à l’identique', async () => {
    for (const code of [stockInternalCode('OC', 42), 'ref-Peinture.5L/blanc']) {
      const [read] = await decode(
        await renderBarcodePng(symbologyFor(code.startsWith('OC') ? 'INTERNAL' : null), code),
      );
      expect(read).toEqual({ text: code, format: 'Code128' });
    }
  });

  it('QR code relu à l’identique', async () => {
    const [read] = await decode(await renderQrPng(ean13));
    expect(read).toEqual({ text: ean13, format: 'QRCode' });
  });

  it('le générateur refuse un EAN dont la clé est fausse (aucun code inventé)', async () => {
    const wrong = `${ean13.slice(0, 12)}${(gtinCheckDigit(ean13.slice(0, 12)) + 1) % 10}`;
    await expect(renderBarcodePng('ean13', wrong)).rejects.toThrow();
  });

  it('PDF : une page par étiquette, à la taille exacte du format', async () => {
    const label = (copies: number): LabelContent => ({
      storeName: 'Quincaillerie Démo',
      productName: 'Peinture acrylique blanche mate intérieure',
      variantName: '5 L',
      reference: 'OC-000001',
      code: ean13,
      symbology: 'ean13',
      price: '12 500 FCFA',
      copies,
    });
    const pdf = await renderLabelsPdf(
      '50x30',
      ['storeName', 'productName', 'variant', 'barcode', 'qrCode', 'price'],
      [label(2), label(1)],
    );
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(3);
    // 50 × 30 mm = 141,73 × 85,04 points.
    expect(text).toMatch(/\/MediaBox \[0 0 141\.73\d* 85\.03\d*\]/);
  });
});
