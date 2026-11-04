import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SuiteContractsModule } from '../suite-contracts/suite-contracts.module';
import { SchoolAccessGuard } from './school-access';
import { SchoolAssessmentController, SchoolQuranController } from './school-assessment.controller';
import { SchoolAssessmentService } from './school-assessment.service';
import { SchoolDocumentsService } from './school-documents.service';
import { SchoolEnrollmentsService } from './school-enrollments.service';
import { SchoolGuardiansService } from './school-guardians.service';
import { SchoolImportsService } from './school-imports.service';
import { SchoolMembersService } from './school-members.service';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolQuranService } from './school-quran.service';
import { SchoolReportCardsService } from './school-report-cards.service';
import { SchoolFilesController, SchoolStudentsController } from './school-students.controller';
import { SchoolStudentsService } from './school-students.service';
import { SchoolTeachingController } from './school-teaching.controller';
import { SchoolTeachingService } from './school-teaching.service';
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
  ],
})
export class SchoolModule {}
