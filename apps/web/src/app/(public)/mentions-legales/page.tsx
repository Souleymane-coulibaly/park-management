import type { Metadata } from 'next';
import { LegalValue, joinLegal, loadLegalIdentity } from '@/components/public/legal-identity';
import { DRAFT_ROBOTS, LegalPage } from '@/components/public/legal-page';

// Identité saisie dans l'administration, relue toutes les 5 minutes.
export const dynamic = 'force-dynamic';

function fields(id: Awaited<ReturnType<typeof loadLegalIdentity>>) {
  return {
    legalName: id?.legalName ?? null,
    form: joinLegal([id?.legalForm, id?.shareCapital ? `capital ${id.shareCapital}` : null]),
    seat: joinLegal([id?.address, id?.city, id?.country]),
    registration: joinLegal(
      [id?.rccm ? `RCCM ${id.rccm}` : null, id?.nif ? `NIF ${id.nif}` : null],
      ' · ',
    ),
    director: id?.publicationDirector ?? null,
    contact: joinLegal([id?.email, id?.phone], ' · '),
    hosting: id?.hostingProvider ?? null,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const f = fields(await loadLegalIdentity());
  const complete = Object.values(f).every(Boolean);
  return { title: 'Mentions légales', ...(complete ? {} : { robots: DRAFT_ROBOTS }) };
}

export default async function MentionsLegalesPage() {
  const f = fields(await loadLegalIdentity());
  return (
    <LegalPage
      eyebrow="Informations"
      title="Mentions légales"
      draft={!Object.values(f).every(Boolean)}
    >
      <section>
        <h2>Éditeur du site</h2>
        <ul className="mt-2 space-y-1">
          <li>
            Raison sociale : <LegalValue value={f.legalName} missing="raison sociale" />
          </li>
          <li>
            Forme juridique et capital :{' '}
            <LegalValue value={f.form} missing="forme juridique, capital" />
          </li>
          <li>
            Siège social : <LegalValue value={f.seat} missing="adresse du siège" />
          </li>
          <li>
            Immatriculation : <LegalValue value={f.registration} missing="RCCM et NIF" />
          </li>
          <li>
            Directeur de la publication :{' '}
            <LegalValue value={f.director} missing="nom et fonction" />
          </li>
          <li>
            Contact : <LegalValue value={f.contact} missing="e-mail et téléphone" />
          </li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>
          Application hébergée dans une région européenne, chez{' '}
          <LegalValue value={f.hosting} missing="hébergeur(s), raison sociale et adresse" />.
        </p>
      </section>
      <section>
        <h2>Propriété intellectuelle</h2>
        <p>
          Les marques Ocall Suite, Ocall Park et leurs logos, ainsi que les contenus de ce site,
          sont protégés. Toute reproduction sans autorisation est interdite.
        </p>
      </section>
    </LegalPage>
  );
}
