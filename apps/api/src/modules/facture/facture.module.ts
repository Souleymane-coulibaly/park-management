import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { FactureAccessGuard } from './facture-access';
import { FactureMembersService } from './facture-members.service';
import { FacturePrismaService } from './facture-prisma.service';
import { FactureController } from './facture.controller';
import { FactureService } from './facture.service';

/**
 * Domaine Ocall Facture. N'importe aucun module métier Ocall Park ni Ocall School (règle vérifiée par un
 * test) : seuls le socle commun (identité, organisations, abonnements, stockage, PDF) est partagé.
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [FactureController],
  providers: [FacturePrismaService, FactureAccessGuard, FactureService, FactureMembersService],
})
export class FactureModule {}
