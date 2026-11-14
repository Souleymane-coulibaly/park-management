import { contentDisposition } from './download';

describe('contentDisposition', () => {
  it('nom ASCII : forme simple inchangée', () => {
    expect(contentDisposition('FAC-2026-00001.pdf')).toBe(
      'attachment; filename="FAC-2026-00001.pdf"',
    );
  });

  it.each([
    ['facture’fournisseur.pdf', 'facture_fournisseur.pdf', 'facture%E2%80%99fournisseur.pdf'],
    ['Bon de réception.pdf', 'Bon de reception.pdf', 'Bon%20de%20r%C3%A9ception.pdf'],
    ['reçu (copie).jpg', 'recu (copie).jpg', 're%C3%A7u%20%28copie%29.jpg'],
  ])('%s : repli ASCII et nom exact encodé', (name, ascii, encoded) => {
    const header = contentDisposition(name);
    expect(header).toBe(`attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
    // Toujours acceptable par Node dans un en-tête (aucun caractère au-delà de U+00FF).
    expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
    expect(decodeURIComponent(encoded)).toBe(name);
  });

  it('guillemets, barres obliques inverses et retours à la ligne neutralisés', () => {
    expect(contentDisposition('a"b\\c\r\nd.pdf')).toBe('attachment; filename="a_b_c__d.pdf"');
  });
});
