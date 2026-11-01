import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SUITE_CONTRACT_STATUSES,
  SUPPORTED_COUNTRIES,
  type SuiteContractStatus,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ContractLimitsDto {
  @ApiPropertyOptional({ description: 'Nombre maximal d’établissements.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxSchools?: number;
}

export class ContractTermsDto {
  @ApiProperty({ example: 'OCS-2026-0001' })
  @Transform(trim)
  @IsString()
  @Length(3, 60)
  reference: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  startsOn: string;

  @ApiProperty({ example: '2027-08-31' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  endsOn: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  modules?: string[];

  @ApiPropertyOptional({ type: ContractLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContractLimitsDto)
  limits?: ContractLimitsDto;
}

/** Contrat pour un client existant (ex. un parc qui ajoute Ocall School). */
export class CreateContractDto extends ContractTermsDto {
  @ApiProperty()
  @IsUUID('4')
  organizationId: string;
}

/** Nouveau client sans activité Ocall Park, avec son premier contrat en brouillon. */
export class CreateContractClientDto extends ContractTermsDto {
  @ApiProperty({ example: 'Groupe scolaire Al Amine' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  organizationName: string;

  @ApiProperty({ example: 'ML', enum: SUPPORTED_COUNTRIES.map((c) => c.code) })
  @IsIn(SUPPORTED_COUNTRIES.map((c) => c.code))
  countryCode: string;

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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  ownerEmail: string;
}

export class ContractTransitionDto {
  @ApiProperty({ enum: SUITE_CONTRACT_STATUSES })
  @IsIn(SUITE_CONTRACT_STATUSES)
  status: SuiteContractStatus;

  @ApiProperty({ example: 'Contrat signé le 15 août' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class RenewContractDto {
  @ApiProperty({ example: '2028-08-31' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  endsOn: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class UpdateContractScopeDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  modules?: string[];

  @ApiPropertyOptional({ type: ContractLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContractLimitsDto)
  limits?: ContractLimitsDto;

  @ApiPropertyOptional({ type: [String], description: 'Vide : tous les établissements du client.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  coveredSchoolIds?: string[];
}
