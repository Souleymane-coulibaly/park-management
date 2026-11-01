import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SuiteContractsModule } from '../suite-contracts/suite-contracts.module';
import { SchoolAccessGuard } from './school-access';
import { SchoolMembersService } from './school-members.service';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolController, SchoolPlatformController } from './school.controllers';
import { SchoolService } from './school.service';

/**
 * Domaine Ocall School. N'importe aucun module métier Ocall Park (règle vérifiée par un test) : seuls
 * le socle commun, les contrats et l'identité Ocall Suite sont partagés.
 */
@Module({
  imports: [OrganizationsModule, SuiteContractsModule],
  controllers: [SchoolController, SchoolPlatformController],
  providers: [SchoolPrismaService, SchoolService, SchoolMembersService, SchoolAccessGuard],
})
export class SchoolModule {}
