import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';
import { type AuthContext, requireTenant } from '../../../common/auth-context';
import { CurrentAuth, RequirePermission } from '../../../common/decorators';
import { CopilotService } from './copilot.service';

export class CopilotQuestionDto {
  @ApiProperty({ description: 'Établissement analysé (contrôlé par le serveur).' })
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Quel est mon chiffre d’affaires aujourd’hui ?' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 500)
  question: string;
}

@ApiTags('IA — copilote analytique')
@Controller('ai/copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  /** Question en français ; réponse en lecture seule, chiffres calculés par le serveur. */
  @RequirePermission('ai.copilot')
  @HttpCode(200)
  @Post('ask')
  ask(@CurrentAuth() auth: AuthContext, @Body() dto: CopilotQuestionDto) {
    return this.copilot.ask(requireTenant(auth), dto.establishmentId, dto.question);
  }
}
