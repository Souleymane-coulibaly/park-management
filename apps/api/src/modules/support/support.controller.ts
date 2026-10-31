import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { SUPPORT_ATTACHMENTS_PER_MESSAGE, SUPPORT_ATTACHMENT_MAX_BYTES } from '@ocall/shared';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import {
  CurrentAuth,
  RequirePermission,
  RequirePlatformPermission,
  SuperAdminOnly,
} from '../../common/decorators';
import type { UploadedFileInMemory } from '../ai/uploaded-file';
import {
  CreateTicketDto,
  OcallReplyDto,
  ReplyTicketDto,
  TicketsQueryDto,
  UpdateTicketDto,
} from './support.dto';
import { SupportService } from './support.service';

const attachments = FilesInterceptor('files', SUPPORT_ATTACHMENTS_PER_MESSAGE, {
  limits: { fileSize: SUPPORT_ATTACHMENT_MAX_BYTES, files: SUPPORT_ATTACHMENTS_PER_MESSAGE },
});

/** Support côté client : demandes de l'organisation (isolées), fil de discussion, pièces jointes. */
@ApiTags('Support')
@RequirePermission('support.use')
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.support.listForClient(requireTenant(auth));
  }

  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.getForClient(requireTenant(auth), id);
  }

  @UseInterceptors(attachments)
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateTicketDto,
    @UploadedFiles() files: UploadedFileInMemory[] | undefined,
  ) {
    return this.support.create(requireTenant(auth), dto, files ?? []);
  }

  @UseInterceptors(attachments)
  @Post(':id/messages')
  reply(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyTicketDto,
    @UploadedFiles() files: UploadedFileInMemory[] | undefined,
  ) {
    return this.support.replyAsClient(requireTenant(auth), id, dto.body, files ?? []);
  }
}

/** Support côté Ocall : toutes les demandes, réponses, notes internes, statut, affectation. */
@ApiTags('Plateforme Ocall Suite')
@SuperAdminOnly()
@RequirePlatformPermission('platform.support.manage')
@Controller('platform/support')
export class PlatformSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  list(@CurrentAuth() auth: AuthContext, @Query() q: TicketsQueryDto) {
    return this.support.listForOcall({
      status: q.status,
      organizationId: q.organizationId,
      product: q.product,
      assignedToMe: q.mine,
      userId: auth.user.id,
    });
  }

  @Get('agents')
  agents() {
    return this.support.agents();
  }

  @Get('tickets/:id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.getForOcall(auth, id);
  }

  @UseInterceptors(attachments)
  @Post('tickets/:id/messages')
  reply(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OcallReplyDto,
    @UploadedFiles() files: UploadedFileInMemory[] | undefined,
  ) {
    return this.support.replyAsOcall(auth, id, dto, files ?? []);
  }

  @Patch('tickets/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.support.updateForOcall(auth, id, dto);
  }
}
