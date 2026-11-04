'use client';

import type { SchoolGradingRules } from '@ocall/shared';
import type { RosterStudentView } from './school-assessment';

/** Vue d'ensemble des bulletins d'une classe (classements et bulletins, Sprint 4). */
export interface ReportCardsOverview {
  validation: { id: string; validatedAt: string } | null;
  rules: SchoolGradingRules;
  rankingEnabled: boolean;
  classAverage: number | null;
  students: (RosterStudentView & {
    generalAverage: number | null;
    rank: number | null;
    tied: boolean;
    passed: boolean | null;
    comment: { text: string; textAr: string | null } | null;
  })[];
}
