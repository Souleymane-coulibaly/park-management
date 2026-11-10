import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  FACTURE_INTERVENTION_STATUSES,
  FACTURE_MAX_INTERVENTION_TECHNICIANS,
  FACTURE_MAX_QUANTITY,
  FACTURE_MAX_TIME_ENTRY_MINUTES,
  type FactureInterventionStatus,
} from '@ocall/shared';

/**
 * Ocall Facture — interventions (F3) : équipements des clients, planning, travaux (temps, pièces,
 * photos), rapport, signature, facturation.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const notNull = (_: unknown, v: unknown) => v !== null;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^\+[0-9][0-9 ().-]{6,22}$/;

// ─── Équipements ───

export class FactureEquipmentDto {
  @ApiProperty({ description: 'Client propriétaire de l’équipement (fixé à la création)' })
  @IsUUID()
  clientId: string;

  @ApiProperty({ description: 'Désignation (ex. « Climatiseur salle de réunion »)' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  brand?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  model?: string | null;

  @ApiPropertyOptional({ description: 'Numéro de série' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  serialNumber?: string | null;

  @ApiPropertyOptional({ description: 'Emplacement chez le client' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(160)
  location?: string | null;

  @ApiPropertyOptional({ description: 'Date de mise en service (AAAA-MM-JJ)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(ISO_DAY)
  @IsISO8601({ strict: true })
  installedAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateFactureEquipmentDto extends PartialType(
  OmitType(FactureEquipmentDto, ['clientId'] as const),
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class FactureEquipmentQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Inclure les équipements archivés' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  archived?: boolean;
}

// ─── Planning ───

export class CreateFactureInterventionDto {
  @ApiProperty()
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({ description: 'Équipement du client concerné' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  equipmentId?: string | null;

  @ApiProperty({ description: 'Objet de la demande' })
  @Transform(trim)
  @IsString()
  @Length(3, 160)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'Lieu d’intervention (adresse du client par défaut)' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(240)
  siteAddress?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @ApiPropertyOptional({ description: 'Téléphone au format international (+223 …)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(PHONE, { message: 'Téléphone au format international (+223 …).' })
  contactPhone?: string | null;

  @ApiProperty({ description: 'Début du créneau (ISO 8601, avec fuseau)' })
  @IsISO8601({ strict: true })
  scheduledStart: string;

  @ApiProperty({ description: 'Fin du créneau (ISO 8601, avec fuseau)' })
  @IsISO8601({ strict: true })
  scheduledEnd: string;

  @ApiProperty({ description: 'Membres affectés (techniciens ou gérants)', type: [String] })
  @IsArray()
  @ArrayMaxSize(FACTURE_MAX_INTERVENTION_TECHNICIANS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  technicianIds: string[];
}

/** Modification du planning : le client d'une intervention ne change pas. */
export class UpdateFactureInterventionDto extends PartialType(
  OmitType(CreateFactureInterventionDto, ['clientId'] as const),
) {}

export class FactureInterventionQueryDto {
  @ApiPropertyOptional({ description: 'Premier jour du planning (AAAA-MM-JJ)' })
  @IsOptional()
  @Matches(ISO_DAY)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Dernier jour du planning (AAAA-MM-JJ, inclus)' })
  @IsOptional()
  @Matches(ISO_DAY)
  @IsISO8601({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: FACTURE_INTERVENTION_STATUSES })
  @IsOptional()
  @IsIn(FACTURE_INTERVENTION_STATUSES)
  status?: FactureInterventionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Technicien affecté' })
  @IsOptional()
  @IsUUID()
  memberId?: string;
}

export class CancelFactureInterventionDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

// ─── Travaux ───

export class FactureTimeEntryDto {
  @ApiPropertyOptional({
    description: 'Technicien affecté (par défaut : soi-même, pour un technicien)',
  })
  @IsOptional()
  @IsUUID()
  memberId?: string;

  @ApiProperty({ description: 'Jour travaillé (AAAA-MM-JJ), au plus tard aujourd’hui' })
  @Matches(ISO_DAY)
  @IsISO8601({ strict: true })
  workDate: string;

  @ApiProperty({ minimum: 1, maximum: FACTURE_MAX_TIME_ENTRY_MINUTES })
  @IsInt()
  @Min(1)
  @Max(FACTURE_MAX_TIME_ENTRY_MINUTES)
  minutes: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class FacturePartUsageDto {
  @ApiProperty({ description: 'Article du catalogue' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ description: 'Quantité, trois décimales au plus' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(FACTURE_MAX_QUANTITY)
  quantity: number;
}

export class FacturePhotoDto {
  @ApiPropertyOptional({ description: 'Légende' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(160)
  caption?: string | null;
}

export class CompleteFactureInterventionDto {
  @ApiProperty({ description: 'Travaux réalisés (rapport)' })
  @Transform(trim)
  @IsString()
  @Length(3, 4000)
  workSummary: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  recommendations?: string | null;

  @ApiPropertyOptional({
    description:
      'Proposition IA relue et validée (rapport intelligent, F6A), tracée comme appliquée',
  })
  @IsOptional()
  @IsUUID()
  aiProposalId?: string;
}

export class SignFactureInterventionDto {
  @ApiProperty({ description: 'Nom du signataire, côté client' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  signerName: string;
}

export class InvoiceFactureInterventionDto {
  @ApiPropertyOptional({
    description: 'Prestation du catalogue facturée à l’heure pour le temps passé',
  })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  laborItemId?: string | null;
}
