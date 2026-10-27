import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsTimeZone, Length } from 'class-validator';
import { BUSINESS_TYPES, type BusinessType } from '@ocall/shared';

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
