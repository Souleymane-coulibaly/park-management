import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUUID,
  Length,
} from 'class-validator';
import { BUSINESS_TYPES, type BusinessType, INVITABLE_ROLES } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ example: 'Africa/Bamako' })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}

export class ChangeBusinessTypeDto {
  @ApiProperty({ enum: BUSINESS_TYPES, example: 'PARK_RESTAURANT' })
  @IsIn(BUSINESS_TYPES)
  businessType: BusinessType;
}

/** Ocall Suite Sprint 2C : invitation d'une personne qui a déjà un compte Ocall. */
export class CreateInvitationDto {
  @ApiProperty({ description: 'E-mail ou identifiant de connexion de la personne' })
  @IsString()
  @Length(3, 160)
  identifier: string;

  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsIn(INVITABLE_ROLES)
  role: string;

  @ApiPropertyOptional({ type: [String], description: 'Établissements (rôles limités)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  establishmentIds?: string[];
}
