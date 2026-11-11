import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CurrentFacture,
  FactureAccessGuard,
  type FactureContext,
  RequireFacturePermission,
} from './facture-access';
import {
  FactureMemberSkillsDto,
  FactureSkillDto,
  FactureUnavailabilityDto,
  FactureUnavailabilityQueryDto,
  UpdateFactureSkillDto,
} from './facture-skills.dto';
import { FactureSkillsService } from './facture-skills.service';

const uuid = new ParseUUIDPipe();

/** Ocall Facture — compétences et indisponibilités des techniciens (F6B). */
@ApiTags('Ocall Facture')
@UseGuards(FactureAccessGuard)
@Controller('facture')
export class FactureSkillsController {
  constructor(private readonly skills: FactureSkillsService) {}

  @RequireFacturePermission('facture.members.read', 'facture.interventions.manage')
  @Get('skills')
  list(@CurrentFacture() ctx: FactureContext) {
    return this.skills.skills(ctx);
  }

  @RequireFacturePermission('facture.members.manage')
  @Post('skills')
  create(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureSkillDto) {
    return this.skills.createSkill(ctx, dto);
  }

  @RequireFacturePermission('facture.members.manage')
  @Patch('skills/:id')
  update(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFactureSkillDto,
  ) {
    return this.skills.updateSkill(ctx, id, dto);
  }

  @RequireFacturePermission('facture.members.read', 'facture.interventions.manage')
  @Get('member-skills')
  memberSkills(@CurrentFacture() ctx: FactureContext) {
    return this.skills.memberSkills(ctx);
  }

  @RequireFacturePermission('facture.members.manage')
  @Put('members/:id/skills')
  setMemberSkills(
    @CurrentFacture() ctx: FactureContext,
    @Param('id', uuid) id: string,
    @Body() dto: FactureMemberSkillsDto,
  ) {
    return this.skills.setMemberSkills(ctx, id, dto.skillIds);
  }

  @RequireFacturePermission('facture.interventions.read', 'facture.interventions.manage')
  @Get('unavailabilities')
  unavailabilities(
    @CurrentFacture() ctx: FactureContext,
    @Query() query: FactureUnavailabilityQueryDto,
  ) {
    return this.skills.unavailabilities(ctx, query);
  }

  @RequireFacturePermission('facture.interventions.manage')
  @Post('unavailabilities')
  addUnavailability(@CurrentFacture() ctx: FactureContext, @Body() dto: FactureUnavailabilityDto) {
    return this.skills.addUnavailability(ctx, dto);
  }

  @RequireFacturePermission('facture.interventions.manage')
  @HttpCode(204)
  @Delete('unavailabilities/:id')
  removeUnavailability(@CurrentFacture() ctx: FactureContext, @Param('id', uuid) id: string) {
    return this.skills.removeUnavailability(ctx, id);
  }
}
