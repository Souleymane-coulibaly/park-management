import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SuiteContractsModule } from '../suite-contracts/suite-contracts.module';
import { SchoolAccessGuard } from './school-access';
import { SchoolAnnouncementsService } from './school-announcements.service';
import { SchoolAssessmentController, SchoolQuranController } from './school-assessment.controller';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolAttendanceService } from './school-attendance.service';
import { SchoolCalendarService } from './school-calendar.service';
import {
  SchoolAttendanceController,
  SchoolCommunicationController,
  SchoolPortalAdminController,
} from './school-communication.controller';
import { SchoolDocumentsService } from './school-documents.service';
import { SchoolEnrollmentsService } from './school-enrollments.service';
import { SchoolExamsService } from './school-exams.service';
import { SchoolFinanceController } from './school-finance.controller';
import { SchoolFinanceService } from './school-finance.service';
import { SchoolGuardiansService } from './school-guardians.service';
import { SchoolImportsService } from './school-imports.service';
import { SchoolMembersService } from './school-members.service';
import { SchoolNotificationsService } from './school-notifications.service';
import { SchoolPaymentsService } from './school-payments.service';
import { SchoolCalendarController, SchoolPlanningController } from './school-planning.controller';
import { SchoolAiAnalysisService } from './ai/school-ai-analysis.service';
import { SchoolAiCopilotService } from './ai/school-ai-copilot.service';
import { SchoolAiPrivacyService } from './ai/school-ai-privacy.service';
import { SchoolAiTeachingService } from './ai/school-ai-teaching.service';
import { SchoolAiUsageStore } from './ai/school-ai-usage.store';
import { SchoolAiController } from './ai/school-ai.controller';
import { SchoolAiService } from './ai/school-ai.service';
import { SchoolReportingController } from './school-reporting.controller';
import { SchoolReportingService } from './school-reporting.service';
import { SchoolPortalAccountsService } from './school-portal-accounts.service';
import {
  SchoolPortalActivationController,
  SchoolPortalController,
  SchoolPortalGuard,
} from './school-portal.controller';
import { SchoolPortalService } from './school-portal.service';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolPublicationsService } from './school-publications.service';
import { SchoolQuranService } from './school-quran.service';
import { SchoolReportCardsService } from './school-report-cards.service';
import { SchoolRoomsService } from './school-rooms.service';
import { SCHOOL_SMS_PROVIDER, SimulatedSmsProvider } from './school-sms.provider';
import { SchoolSmsService } from './school-sms.service';
import { SchoolFilesController, SchoolStudentsController } from './school-students.controller';
import { SchoolStudentsService } from './school-students.service';
import { SchoolTeachingController } from './school-teaching.controller';
import { SchoolTeachingService } from './school-teaching.service';
import { SchoolTimetablesService } from './school-timetables.service';
import { SchoolController, SchoolPlatformController } from './school.controllers';
import { SchoolService } from './school.service';

/**
 * Domaine Ocall School. N'importe aucun module métier Ocall Park (règle vérifiée par un test) : seuls
 * le socle commun, les contrats et l'identité Ocall Suite sont partagés.
 */
@Module({
  imports: [OrganizationsModule, SuiteContractsModule],
  controllers: [
    SchoolController,
    SchoolPlatformController,
    SchoolStudentsController,
    SchoolFilesController,
    SchoolTeachingController,
    SchoolAssessmentController,
    SchoolQuranController,
    SchoolFinanceController,
    SchoolPortalAdminController,
    SchoolAttendanceController,
    SchoolCommunicationController,
    SchoolPortalActivationController,
    SchoolPortalController,
    SchoolPlanningController,
    SchoolCalendarController,
    SchoolReportingController,
    SchoolAiController,
  ],
  providers: [
    SchoolPrismaService,
    SchoolService,
    SchoolMembersService,
    SchoolAccessGuard,
    SchoolStudentsService,
    SchoolEnrollmentsService,
    SchoolGuardiansService,
    SchoolDocumentsService,
    SchoolImportsService,
    SchoolTeachingService,
    SchoolAssessmentService,
    SchoolReportCardsService,
    SchoolQuranService,
    SchoolFinanceService,
    SchoolPaymentsService,
    // Sprint 6 : portail parents, présences, communication, notifications, SMS.
    // Seul le fournisseur simulé existe (configuration validée au démarrage) : aucun SMS réel.
    { provide: SCHOOL_SMS_PROVIDER, useClass: SimulatedSmsProvider },
    SchoolSmsService,
    SchoolNotificationsService,
    SchoolPortalAccountsService,
    SchoolPortalGuard,
    SchoolAttendanceService,
    SchoolAnnouncementsService,
    SchoolPublicationsService,
    SchoolPortalService,
    // Sprint 7 : salles, emplois du temps, calendrier scolaire, examens.
    SchoolRoomsService,
    SchoolCalendarService,
    SchoolExamsService,
    SchoolReportingService,
    // Sprint 8 : Ocall School AI sur Ocall AI Core (copilote, assistant pédagogique, analyse).
    SchoolAiUsageStore,
    SchoolAiPrivacyService,
    SchoolAiService,
    SchoolAiCopilotService,
    SchoolAiTeachingService,
    SchoolAiAnalysisService,
    SchoolTimetablesService,
  ],
})
export class SchoolModule {}
