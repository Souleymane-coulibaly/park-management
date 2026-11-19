import sharp from 'sharp';
import { isImageRefusal, processPrintLogo, processPrintPhoto } from './print-images';

describe('images Ocall Print', () => {
  it('réencode la photo en JPEG sans aucune métadonnée (EXIF, GPS)', async () => {
    const input = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: '#336699' },
    })
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-appareil', Artist: 'parent' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processPrintPhoto(input);
    if (isImageRefusal(out)) throw new Error(out.message);
    const meta = await sharp(out.body).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(out.body.includes(Buffer.from('secret-appareil'))).toBe(false);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applique l’orientation puis contrôle les dimensions', async () => {
    const input = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#000000' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await processPrintPhoto(input);
    if (isImageRefusal(out)) throw new Error(out.message);
    expect(out.height).toBeGreaterThan(out.width);
  });

  it('refuse une image trop petite, un faux fichier, un SVG', async () => {
    const tiny = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    expect(isImageRefusal(await processPrintPhoto(tiny))).toBe(true);
    expect(isImageRefusal(await processPrintPhoto(Buffer.from('pas une image')))).toBe(true);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(isImageRefusal(await processPrintPhoto(svg))).toBe(true);
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    expect(isImageRefusal(await processPrintPhoto(fake))).toBe(true);
  });

  it('logo : PNG, transparence conservée', async () => {
    const input = await sharp({
      create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await processPrintLogo(input);
    if (isImageRefusal(out)) throw new Error(out.message);
    const meta = await sharp(out.body).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
  });
});
