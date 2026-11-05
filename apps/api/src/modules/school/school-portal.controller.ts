import {
  Body,
  CanActivate,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, Public } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import { SensitiveRoute } from '../../common/throttling';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { download } from './school-download';
import { SchoolNotificationsService } from './school-notifications.service';
import { SchoolPortalAccountsService } from './school-portal-accounts.service';
import {
  ActivationCheckDto,
  ActivationDto,
  DateRangeQueryDto,
  GuardianJustificationDto,
  NotificationQueryDto,
  PortalAnnouncementsQueryDto,
  PortalYearQueryDto,
} from './school-portal.dto';
import { SchoolPortalService } from './school-portal.service';

/**
 * Garde du portail parents : Ocall School activé et compte de portail « responsable ». Un membre
 * d'organisation, un compte interne ou un partenaire n'y a jamais accès. Le lien parent-enfant est
 * vérifié ensuite, route par route.
 */
@Injectable()
export class SchoolPortalGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.school.enabled) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ressource introuvable.' });
    }
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (auth?.portal !== 'guardian' || auth.membership || auth.partner || auth.user.platformRole) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Vous n'avez pas les droits nécessaires.",
      });
    }
    return true;
  }
}

/** Activation du compte parent par le lien d'invitation (routes publiques, limitées en débit). */
@ApiTags('Ocall School — portail parents')
@Controller('school/portal/activation')
export class SchoolPortalActivationController {
  constructor(
    private readonly accounts: SchoolPortalAccountsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @SensitiveRoute()
  @HttpCode(200)
  @Post('check')
  check(@Body() dto: ActivationCheckDto) {
    this.assertEnabled();
    return this.accounts.checkInvitation(dto.token);
  }

  @Public()
  @SensitiveRoute()
  @HttpCode(200)
  @Post()
  activate(@Body() dto: ActivationDto, @Req() req: Request) {
    this.assertEnabled();
    return this.accounts.activate(dto.token, dto.password, requestMeta(req));
  }

  private assertEnabled() {
    if (!this.config.school.enabled) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Ressource introuvable.' });
    }
  }
}

/**
 * Portail parents (Sprint 6) : consultation des enfants autorisés et transmission d'un motif d'absence.
 * Toute donnée est filtrée par l'API selon le lien parent-enfant ; un enfant non autorisé est introuvable.
 */
@ApiTags('Ocall School — portail parents')
@UseGuards(SchoolPortalGuard)
@Controller('school/portal')
export class SchoolPortalController {
  constructor(
    private readonly portal: SchoolPortalService,
    private readonly notifications: SchoolNotificationsService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentAuth() auth: AuthContext) {
    return this.portal.dashboard(auth.user.id);
  }

  @Get('children')
  children(@CurrentAuth() auth: AuthContext) {
    return this.portal.children(auth.user.id);
  }

  @Get('children/:id/attendance')
  attendance(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DateRangeQueryDto,
  ) {
    return this.portal.attendanceOf(auth.user.id, id, q.from, q.to);
  }

  @Post('children/:id/justifications')
  justify(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuardianJustificationDto,
  ) {
    return this.portal.justify(auth.user.id, id, dto);
  }

  @Get('children/:id/results')
  results(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.results(auth.user.id, id);
  }

  @Get('children/:id/report-cards/:publicationId')
  async reportCard(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('publicationId', ParseUUIDPipe) publicationId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, filename } = await this.portal.reportCard(auth.user.id, id, publicationId);
    return download(res, file, 'application/pdf', filename);
  }

  @Get('children/:id/finance')
  finance(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PortalYearQueryDto,
  ) {
    return this.portal.finance(auth.user.id, id, q.schoolYearId);
  }

  @Get('children/:id/payments/:paymentId/receipt')
  async receipt(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, filename } = await this.portal.receipt(auth.user.id, id, paymentId);
    return download(res, file, 'application/pdf', filename);
  }

  @Get('children/:id/quran')
  quran(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.quran(auth.user.id, id);
  }

  @Get('announcements')
  announcements(@CurrentAuth() auth: AuthContext, @Query() q: PortalAnnouncementsQueryDto) {
    return this.portal.announcementsFor(auth.user.id, q.page ?? 0);
  }

  @Get('notifications')
  async notificationList(
    @CurrentAuth() auth: AuthContext,
    @Query() q: NotificationQueryDto,
  ): Promise<unknown> {
    const scope = await this.portal.scope(auth.user.id);
    return this.notifications.list(auth.user.id, scope, q.unread ?? false, q.cursor);
  }

  @HttpCode(204)
  @Post('notifications/read-all')
  async readAll(@CurrentAuth() auth: AuthContext) {
    await this.notifications.markAllRead(auth.user.id, await this.portal.scope(auth.user.id));
  }

  @HttpCode(204)
  @Post('notifications/:id/read')
  async read(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(auth.user.id, await this.portal.scope(auth.user.id), id);
  }
}
