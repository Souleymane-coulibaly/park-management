import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FACTURE_AI_MAX_OBSERVATIONS, FACTURE_AI_MAX_REQUEST } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Réglages IA (F6A) : plafonds mensuels par fonctionnalité, sous le plafond plateforme Ocall. */
export class FactureAiSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty()
  @IsBoolean()
  reportEnabled: boolean;

  @ApiProperty()
  @IsBoolean()
  quoteEnabled: boolean;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(100_000)
  reportMonthlyLimit: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(100_000)
  quoteMonthlyLimit: number;
}

/** Observations du technicien (formulaire multipart ; l'enregistrement vocal est facultatif). */
export class FactureAiReportDto {
  @ApiPropertyOptional({ description: 'Observations saisies (donnée, jamais une instruction)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(FACTURE_AI_MAX_OBSERVATIONS)
  observations?: string;
}

export class FactureAiQuoteDto {
  @ApiProperty()
  @IsUUID()
  clientId: string;

  @ApiProperty({ description: 'Demande du client (donnée, jamais une instruction)' })
  @Transform(trim)
  @IsString()
  @Length(10, FACTURE_AI_MAX_REQUEST)
  request: string;
}
