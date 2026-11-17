import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MAX_AMOUNT,
  PASS_DURATION_UNITS,
  PASS_KINDS,
  PASS_QR_MODES,
  PASS_STATUSES,
  type PassDurationUnit,
  type PassKind,
  type PassQrMode,
  type PassStatus,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parc autorisé d'une offre, avec son tarif propre éventuel. */
export class PassOfferSiteDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional({ description: 'Tarif propre à ce parc (FCFA) ; sinon le prix de l’offre.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  price?: number | null;
}

/** Offre de pass (création). */
export class CreatePassOfferDto {
  @ApiProperty({ enum: PASS_KINDS })
  @IsIn(PASS_KINDS)
  kind: PassKind;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Prix de base (FCFA).' })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  price: number;

  @ApiPropertyOptional({ enum: PASS_DURATION_UNITS })
  @IsOptional()
  @IsIn(PASS_DURATION_UNITS)
  durationUnit?: PassDurationUnit;

  @ApiPropertyOptional({ description: 'Durée : jours (1-366) ou mois (1-24).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  durationValue?: number;

  @ApiPropertyOptional({ description: 'Entrées par période (null = illimité).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(10_000)
  totalEntries?: number | null;

  @ApiPropertyOptional({ description: 'Entrées par jour (null = illimité).' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100)
  dailyEntries?: number | null;

  @ApiPropertyOptional({
    description: 'Jours autorisés (0 = dimanche … 6 = samedi) ; vide = tous.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  allowedWeekdays?: number[];

  @ApiPropertyOptional({ enum: PASS_QR_MODES })
  @IsOptional()
  @IsIn(PASS_QR_MODES)
  qrMode?: PassQrMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  photoRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  renewable?: boolean;

  @ApiPropertyOptional({
    description: 'Suspension : durée maximale reportée (jours) ; 0 = interdite.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  maxSuspensionDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  suspensionExtends?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  conditions?: string;

  @ApiPropertyOptional({ description: 'Début de la vente (AAAA-MM-JJ) ; null = sans limite.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE)
  saleFrom?: string | null;

  @ApiPropertyOptional({ description: 'Fin de la vente (AAAA-MM-JJ) ; null = sans limite.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DATE)
  saleUntil?: string | null;

  @ApiProperty({ type: [PassOfferSiteDto], description: 'Parcs autorisés.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PassOfferSiteDto)
  sites: PassOfferSiteDto[];
}

/** Modification d'une offre : tout champ facultatif (liste des parcs remplacée) ; le type ne change jamais. */
export class UpdatePassOfferDto extends PartialType(
  OmitType(CreatePassOfferDto, ['kind'] as const),
) {
  @ApiPropertyOptional({ description: 'Disponible à la vente.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Vente d'un pass au guichet : vente PARK non payée ; le pass est activé au paiement. */
export class CreatePassOrderDto {
  @ApiProperty({ description: 'Parc de la vente (caisse ouverte).' })
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty()
  @IsUUID('4')
  offerId: string;

  @ApiProperty({ description: 'Fiche client du titulaire (obligatoire).' })
  @IsUUID('4')
  customerId: string;

  @ApiProperty({ description: 'Premier jour de validité (AAAA-MM-JJ, heure du parc).' })
  @Matches(DATE)
  startDate: string;

  @ApiPropertyOptional({ description: 'Photo du titulaire (déposée au préalable).' })
  @IsOptional()
  @IsUUID('4')
  photoFileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}

export class RenewPassDto {
  @ApiProperty({ description: 'Parc de la vente (caisse ouverte).' })
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}

export class PassReasonDto {
  @ApiProperty({ description: 'Motif (obligatoire).' })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason: string;
}

export class PassPhotoDto {
  @ApiProperty()
  @IsUUID('4')
  photoFileId: string;
}

export class PassesQueryDto {
  @ApiPropertyOptional({ description: 'Nom du titulaire ou téléphone.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({ enum: PASS_STATUSES })
  @IsOptional()
  @IsIn(PASS_STATUSES)
  status?: PassStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  customerId?: string;
}
