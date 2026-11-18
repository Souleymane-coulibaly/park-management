import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Res } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { OCALL_LEGAL_FIELD_MAX_LENGTH } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import {
  CurrentAuth,
  Public,
  RequirePermission,
  RequirePlatformPermission,
} from '../../common/decorators';
import { download } from '../../common/download';
import { PublicSiteRoute } from '../../common/throttling';
import { LegalIdentityService } from './legal-identity.service';
import { OcallBillingDocumentsService } from './ocall-billing-documents.service';

const M = OCALL_LEGAL_FIELD_MAX_LENGTH;

/** Champs transmis seulement s'ils changent ; chaîne vide = effacer. Rien n'est inventé ni complété. */
export class UpdateLegalIdentityDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) tradeName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) legalForm?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) shareCapital?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) rccm?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) nif?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) taxRegime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) publicationDirector?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) whatsapp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) privacyEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) hostingProvider?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(M) bankDetails?: string;
}

/** Administration : identité légale d'Ocall, factures et reçus d'abonnement en PDF. */
@ApiTags('platform')
@Controller('platform')
export class OcallLegalController {
  constructor(
    private readonly legal: LegalIdentityService,
    private readonly documents: OcallBillingDocumentsService,
  ) {}

  // Lisible par la facturation (émission) comme par le propriétaire et l'audit.
  @RequirePlatformPermission('platform.billing.read')
  @Get('legal-identity')
  identity() {
    return this.legal.view();
  }

  @RequirePlatformPermission('platform.legal.manage')
  @Put('legal-identity')
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateLegalIdentityDto) {
    return this.legal.update(auth, dto);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('invoices/:id/pdf')
  async invoicePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, filename } = await this.documents.invoicePdf(id);
    return download(res, body, 'application/pdf', filename);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('subscription-payments/:id/receipt')
  async receiptPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, filename } = await this.documents.receiptPdf(id);
    return download(res, body, 'application/pdf', filename);
  }
}

/** Espace client : factures et reçus Ocall de l'organisation uniquement. */
@ApiTags('billing')
@Controller('billing')
export class ClientBillingDocumentsController {
  constructor(private readonly documents: OcallBillingDocumentsService) {}

  @RequirePermission('subscription.read')
  @Get('invoices/:id/pdf')
  async invoicePdf(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenant = requireTenant(auth);
    const { body, filename } = await this.documents.invoicePdf(
      id,
      tenant.membership.organizationId,
    );
    return download(res, body, 'application/pdf', filename);
  }

  @RequirePermission('subscription.read')
  @Get('payments/:id/receipt')
  async receiptPdf(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenant = requireTenant(auth);
    const { body, filename } = await this.documents.receiptPdf(
      id,
      tenant.membership.organizationId,
    );
    return download(res, body, 'application/pdf', filename);
  }
}

/** Pages légales du site : identité publiable d'Ocall (jamais les coordonnées bancaires). */
@ApiTags('public')
@Public()
@Controller('public/suite')
export class PublicLegalIdentityController {
  constructor(private readonly legal: LegalIdentityService) {}

  @PublicSiteRoute()
  @Get('legal-identity')
  identity() {
    return this.legal.publicView();
  }
}
