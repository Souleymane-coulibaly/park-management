'use client';

import {
  SCHOOL_LOCALES,
  SCHOOL_LOCALE_LABELS,
  SCHOOL_TYPES,
  SCHOOL_TYPE_LABELS,
  SUPPORTED_COUNTRIES,
} from '@ocall/shared';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';

export default function EtablissementsPage() {
  return (
    <SchoolPage
      title="Établissements"
      description="Écoles du groupe : classiques, franco-arabes ou complexes."
      needsSchool={false}
    >
      {({ context, canWrite, reloadContext }) => (
        <>
          <Card>
            <ul className="divide-y divide-line/70" data-testid="school-list">
              {context.schools.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted">Aucun établissement.</li>
              )}
              {context.schools.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-full min-w-0 font-semibold sm:w-auto sm:flex-1">
                    <BiName name={s.name} nameAr={s.nameAr} />
                  </span>
                  <Badge tone="neutral">{SCHOOL_TYPE_LABELS[s.type]}</Badge>
                  <span className="text-sm text-muted">
                    {SCHOOL_LOCALE_LABELS[s.defaultLocale]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {canWrite('school.schools.manage') && (
            <Card>
              <CardBody>
                <h2 className="mb-3 font-semibold">Nouvel établissement</h2>
                <SimpleForm
                  testId="school-form"
                  path="/school/schools"
                  submitLabel="Créer l’établissement"
                  onDone={reloadContext}
                  fields={[
                    { name: 'name', label: 'Nom officiel', required: true },
                    { name: 'nameAr', label: 'Nom en arabe', rtl: true },
                    {
                      name: 'type',
                      label: 'Type',
                      type: 'select',
                      options: SCHOOL_TYPES.map((t) => ({
                        value: t,
                        label: SCHOOL_TYPE_LABELS[t],
                      })),
                    },
                    {
                      name: 'countryCode',
                      label: 'Pays',
                      type: 'select',
                      options: SUPPORTED_COUNTRIES.map((c) => ({ value: c.code, label: c.label })),
                    },
                    {
                      name: 'defaultLocale',
                      label: 'Langue des documents',
                      type: 'select',
                      options: SCHOOL_LOCALES.map((l) => ({
                        value: l,
                        label: SCHOOL_LOCALE_LABELS[l],
                      })),
                    },
                    { name: 'address', label: 'Adresse' },
                    { name: 'phone', label: 'Téléphone' },
                    { name: 'email', label: 'E-mail', type: 'email' },
                  ]}
                />
              </CardBody>
            </Card>
          )}
        </>
      )}
    </SchoolPage>
  );
}
