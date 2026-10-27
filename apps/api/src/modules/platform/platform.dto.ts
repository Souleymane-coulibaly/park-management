import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BUSINESS_TYPES, type BusinessType, SUPPORTED_COUNTRIES } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateOrganizationByAdminDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  organizationName: string;

  @ApiProperty({ enum: BUSINESS_TYPES })
  @IsIn(BUSINESS_TYPES)
  businessType: BusinessType;

  @ApiProperty({ example: 'ML' })
  @IsIn(SUPPORTED_COUNTRIES.map((c) => c.code))
  countryCode: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  establishmentName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  ownerFirstName: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  ownerLastName: string;

  @ApiProperty()
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  ownerEmail: string;
}

export class SetOrganizationStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status: 'ACTIVE' | 'SUSPENDED';
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60)
  name?: string;

  @ApiPropertyOptional({ description: 'Prix mensuel entier en FCFA.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  monthlyPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
