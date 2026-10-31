import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission, SuperAdminOnly } from '../../common/decorators';
import {
  AuditQueryDto,
  CancelInvoiceDto,
  ChangeInternalRoleDto,
  CommercialQueryDto,
  CreateInternalUserDto,
  CreatePlanDto,
  CreateProductDto,
  InvoicesQueryDto,
  IssueInvoiceDto,
  SubscribeProductDto,
  UpdateProductDto,
} from './platform.dto';
import { SuiteService } from './suite.service';

/**
 * Administration centrale Ocall Suite (Sprint 11A). Comptes internes uniquement, permission
 * plateforme vérifiée par route (matrice de packages/shared/src/platform.ts) ; MFA exigée par la
 * garde d'authentification pour les rôles sensibles.
 */
@ApiTags('Plateforme Ocall Suite')
@SuperAdminOnly()
@Controller('platform')
export class SuiteController {
  constructor(private readonly suite: SuiteService) {}

  @RequirePlatformPermission('platform.dashboard')
  @Get('commercial')
  commercial(@Query() q: CommercialQueryDto) {
    return this.suite.commercial({ productCode: q.product, from: q.from, to: q.to });
  }

  // ─── Produits ───

  @RequirePlatformPermission('platform.orgs.read')
  @Get('products')
  products() {
    return this.suite.products();
  }

  @RequirePlatformPermission('platform.products.manage')
  @Post('products')
  createProduct(@CurrentAuth() auth: AuthContext, @Body() dto: CreateProductDto) {
    return this.suite.createProduct(auth, dto);
  }

  @RequirePlatformPermission('platform.products.manage')
  @Patch('products/:id')
  updateProduct(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.suite.updateProduct(auth, id, dto);
  }

  @RequirePlatformPermission('platform.plans.manage')
  @Post('products/:id/plans')
  createPlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePlanDto,
  ) {
    return this.suite.createPlan(auth, id, dto);
  }

  // ─── Organisations et abonnements ───

  @RequirePlatformPermission('platform.orgs.read')
  @Get('organizations/:id')
  organization(@Param('id', ParseUUIDPipe) id: string) {
    return this.suite.organization(id);
  }

  @RequirePlatformPermission('platform.subscriptions.manage')
  @Post('organizations/:id/subscriptions')
  subscribe(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubscribeProductDto,
  ) {
    return this.suite.subscribe(auth, id, dto);
  }

  // ─── Factures ───

  @RequirePlatformPermission('platform.billing.read')
  @Get('invoices')
  invoices(@Query() q: InvoicesQueryDto) {
    return this.suite.invoices({
      status: q.status,
      organizationId: q.organizationId,
      productCode: q.product,
    });
  }

  @RequirePlatformPermission('platform.billing.manage')
  @Post('invoices')
  issueInvoice(@CurrentAuth() auth: AuthContext, @Body() dto: IssueInvoiceDto) {
    return this.suite.issueInvoice(auth, dto);
  }

  @RequirePlatformPermission('platform.billing.manage')
  @Post('invoices/:id/cancel')
  cancelInvoice(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInvoiceDto,
  ) {
    return this.suite.cancelInvoice(auth, id, dto.reason);
  }

  // ─── Comptes internes (propriétaire uniquement) ───

  @RequirePlatformPermission('platform.users.manage')
  @Get('users')
  users() {
    return this.suite.users();
  }

  @RequirePlatformPermission('platform.users.manage')
  @Post('users')
  createUser(@CurrentAuth() auth: AuthContext, @Body() dto: CreateInternalUserDto) {
    return this.suite.createUser(auth, dto);
  }

  @RequirePlatformPermission('platform.users.manage')
  @Patch('users/:id/role')
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeInternalRoleDto,
  ) {
    return this.suite.changeUserRole(auth, id, dto.role);
  }

  @RequirePlatformPermission('platform.users.manage')
  @Post('users/:id/deactivate')
  deactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.suite.setUserActive(auth, id, false);
  }

  @RequirePlatformPermission('platform.users.manage')
  @Post('users/:id/reactivate')
  reactivate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.suite.setUserActive(auth, id, true);
  }

  @RequirePlatformPermission('platform.users.manage')
  @Post('users/:id/reset-mfa')
  resetMfa(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.suite.resetUserMfa(auth, id);
  }

  // ─── Audit et sécurité ───

  @RequirePlatformPermission('platform.audit.read')
  @Get('audit')
  audit(@Query() q: AuditQueryDto) {
    return this.suite.auditLog(q.limit ?? 100);
  }
}
