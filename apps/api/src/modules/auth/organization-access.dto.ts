import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Ocall Suite Sprint 2C : organisation où ouvrir la nouvelle session. */
export class SwitchOrganizationDto {
  @ApiProperty()
  @IsUUID()
  organizationId: string;
}
