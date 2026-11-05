'use client';

import Link from 'next/link';
import { childName, usePortal } from '@/components/parents/parent-shell';
import { useSchoolText } from '@/components/school/school-language';
import { Card, CardBody } from '@/components/ui/card';
import { Alert } from '@/components/ui/states';

/** Enfants que le compte peut suivre : un seul compte, plusieurs enfants. */
export default function ChildrenPage() {
  const { children } = usePortal();
  const { t, name, showArabic, language } = useSchoolText();
  if (children.length === 0) return <Alert tone="info" title={t('par.noChildren')} />;
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="children-list">
      {children.map((c) => {
        const base = `/parents/enfants/${c.id}`;
        return (
          <Card key={c.id}>
            <CardBody>
              <h2 className="text-lg font-bold">{childName(c, showArabic, language)}</h2>
              <p className="text-sm text-muted">
                {c.class ? name(c.class) : '—'} · {name(c.school)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {[
                  ['presences', 'par.child.attendance'],
                  ['resultats', 'par.child.results'],
                  ['bulletins', 'par.child.reportCards'],
                  ['finances', 'par.child.finance'],
                ].map(([path, key]) => (
                  <Link
                    key={path}
                    href={`${base}/${path}`}
                    className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-ivory"
                  >
                    {t(key as 'par.child.attendance')}
                  </Link>
                ))}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
