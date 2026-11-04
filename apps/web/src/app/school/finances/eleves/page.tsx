'use client';

import { StudentPicker, YearPicker } from '@/components/school/school-finance';
import { StudentSituation } from '@/components/school/school-finance-situation';
import { SchoolPage } from '@/components/school/school-page';

/** Situation financière des élèves (Sprint 5) : échéances, réductions, paiements, soldes. */
export default function StudentFinancePage() {
  return (
    <SchoolPage title="fin.students.title" description="fin.students.desc">
      {({ school, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <StudentPicker key={year.id} schoolYearId={year.id} includeLeavers>
              {(student) => (
                <StudentSituation
                  key={student.id}
                  studentId={student.id}
                  schoolYearId={year.id}
                  canAdjust={canWrite('school.finance.benefits')}
                />
              )}
            </StudentPicker>
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}
