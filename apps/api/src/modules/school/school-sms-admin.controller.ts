import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission } from '../../common/decorators';
import {
  AdminLedgerQueryDto,
  AdminTopUpQueryDto,
  AdminWalletsQueryDto,
  ApproveTopUpDto,
  RejectTopUpDto,
  SmsAdjustmentDto,
  SmsTariffDto,
} from './school-sms-wallet.dto';
import { SchoolSmsWalletService } from './school-sms-wallet.service';

/**
 * Super Admin Ocall : portefeuilles SMS School, demandes de recharge, corrections motivées, erreurs
 * d'envoi et tarif. Aucune donnée scolaire (élèves, notes) : noms d'établissement, soldes et numéros
 * masqués seulement.
 */
@ApiTags('platform')
@Controller('platform/school-sms')
export class SchoolSmsAdminController {
  constructor(private readonly wallets: SchoolSmsWalletService) {}

  @RequirePlatformPermission('platform.billing.read')
  @Get('wallets')
  list(@Query() q: AdminWalletsQueryDto) {
    return this.wallets.adminWallets(q.organizationId);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('wallets/:schoolId/ledger')
  ledger(@Param('schoolId', ParseUUIDPipe) schoolId: string, @Query() q: AdminLedgerQueryDto) {
    return this.wallets.adminLedger(schoolId, q.cursor);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('wallets/:schoolId/adjustments')
  adjust(
    @CurrentAuth() auth: AuthContext,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Body() dto: SmsAdjustmentDto,
  ) {
    return this.wallets.adjust(auth, schoolId, dto);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('top-ups')
  topUps(@Query() q: AdminTopUpQueryDto) {
    return this.wallets.adminTopUps(q.status);
  }

  /** Validation après vérification du règlement hors plateforme : crédit unique du portefeuille. */
  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('top-ups/:id/approve')
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveTopUpDto,
  ) {
    return this.wallets.approveTopUp(auth, id, dto);
  }

  @RequirePlatformPermission('platform.billing.validate')
  @HttpCode(200)
  @Post('top-ups/:id/reject')
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTopUpDto,
  ) {
    return this.wallets.rejectTopUp(auth, id, dto.note);
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('failures')
  failures() {
    return this.wallets.adminFailures();
  }

  @RequirePlatformPermission('platform.billing.read')
  @Get('tariffs')
  tariffs() {
    return this.wallets.tariffs();
  }

  /** Nouvelle version du tarif SMS (prix de vente, coût fournisseur, international). */
  @RequirePlatformPermission('platform.plans.manage')
  @HttpCode(201)
  @Post('tariffs')
  createTariff(@CurrentAuth() auth: AuthContext, @Body() dto: SmsTariffDto) {
    return this.wallets.createTariff(auth, {
      creditPriceXof: dto.creditPriceXof ?? null,
      providerCostPerSegmentXof: dto.providerCostPerSegmentXof ?? null,
      internationalCreditsPerSegment: dto.internationalCreditsPerSegment ?? null,
      note: dto.note ?? null,
    });
  }
}
