'use client';

import { SchoolSiteAdmin } from '@/components/school/school-site-admin';
import { SchoolPage } from '@/components/school/school-page';

/**
 * Site vitrine public de l'établissement courant (Sprint 10). Le secrétariat prépare, la direction
 * active, publie et dépublie ; les droits réels sont vérifiés par l'API à chaque requête.
 */
export default function SchoolSitePage() {
  return (
    <SchoolPage title="site.title" description="site.desc">
      {({ school, context }) => (
        <SchoolSiteAdmin
          key={school!.id}
          schoolId={school!.id}
          rights={{
            role: context.role,
            full: (school!.contractAccess ?? context.access) === 'full',
          }}
        />
      )}
    </SchoolPage>
  );
}
