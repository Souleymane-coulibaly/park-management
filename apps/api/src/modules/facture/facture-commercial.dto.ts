import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
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
  ValidateNested,
} from 'class-validator';
import {
  FACTURE_CREATABLE_TYPES,
  FACTURE_DOCUMENT_STATUSES,
  FACTURE_DOCUMENT_TYPES,
  FACTURE_MAX_DOCUMENT_TOTAL,
  FACTURE_MAX_LINES,
  FACTURE_MAX_PAYMENT_TERMS_DAYS,
  FACTURE_MAX_QUANTITY,
  FACTURE_MAX_UNIT_PRICE,
  FACTURE_PAYMENT_METHODS,
  FACTURE_REGISTRATION_PATTERN,
  FACTURE_VAT_RATES,
  type FactureCreatableType,
  type FactureDocumentStatus,
  type FactureDocumentType,
  type FacturePaymentMethod,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Champ facultatif : une chaîne vide vaut « non renseigné ». */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const notNull = (_: unknown, v: unknown) => v !== null;

// ─── Clients ───

export class FactureClientDto {
  @ApiPropertyOptional({ enum: ['COMPANY', 'INDIVIDUAL'] })
  @IsOptional()
  @IsIn(['COMPANY', 'INDIVIDUAL'])
  kind?: 'COMPANY' | 'INDIVIDUAL';

  @ApiProperty({ description: 'Raison sociale ou nom du client' })
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @ValidateIf(notNull)
  @IsEmail()
  @MaxLength(160)
  email?: string | null;

  @ApiPropertyOptional({ description: 'Téléphone au format international (+223 …)' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(/^\+[0-9][0-9 ().-]{6,22}$/, { message: 'Téléphone au format international (+223 …).' })
  phone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @ApiPropertyOptional({ description: 'Code pays ISO (ML par défaut)' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'Code pays à deux lettres (ML).' })
  country?: string;

  @ApiPropertyOptional({ description: 'NIF du client assujetti' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(FACTURE_REGISTRATION_PATTERN, { message: 'NIF invalide.' })
  nif?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(FACTURE_REGISTRATION_PATTERN, { message: 'RCCM invalide.' })
  rccm?: string | null;

  @ApiPropertyOptional({ description: 'RIB du client' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  rib?: string | null;

  @ApiPropertyOptional({ description: 'Description imprimée sous le nom du client' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateFactureClientDto extends PartialType(FactureClientDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

export class FactureListQueryDto {
  @ApiPropertyOptional({ description: 'Recherche (nom, référence, NIF)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Inclure les éléments archivés' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  archived?: boolean;
}

// ─── Catalogue ───

export class FactureItemDto {
  @ApiPropertyOptional({ enum: ['PRODUCT', 'SERVICE'] })
  @IsOptional()
  @IsIn(['PRODUCT', 'SERVICE'])
  kind?: 'PRODUCT' | 'SERVICE';

  @ApiPropertyOptional({ description: 'Référence interne, unique' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf(notNull)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/, { message: 'Référence invalide.' })
  reference?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 160)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'Unité (unité, heure, jour, m², forfait…)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 24)
  unit?: string;

  @ApiProperty({ description: 'Prix unitaire hors taxe, en FCFA entiers' })
  @IsInt()
  @Min(0)
  @Max(FACTURE_MAX_UNIT_PRICE)
  unitPrice: number;

  @ApiProperty({ enum: FACTURE_VAT_RATES })
  @IsInt()
  @IsIn(FACTURE_VAT_RATES)
  vatRate: number;
}

export class UpdateFactureItemDto extends PartialType(FactureItemDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

// ─── Documents ───

export class FactureLineDto {
  @ApiPropertyOptional({ description: 'Référence de l’article (colonne « Réf. »)' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(40)
  reference?: string | null;

  @ApiPropertyOptional({ description: 'Article du catalogue d’origine (référence seulement)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  itemId?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 24)
  unit: string;

  @ApiProperty({ description: 'Quantité, trois décimales au plus' })
  @IsNumber({ maxDecimalPlaces: 3, allowNaN: false, allowInfinity: false })
  @Min(0.001)
  @Max(FACTURE_MAX_QUANTITY)
  quantity: number;

  @ApiProperty({ description: 'Prix unitaire hors taxe, en FCFA entiers' })
  @IsInt()
  @Min(0)
  @Max(FACTURE_MAX_UNIT_PRICE)
  unitPrice: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiProperty({ enum: FACTURE_VAT_RATES })
  @IsInt()
  @IsIn(FACTURE_VAT_RATES)
  vatRate: number;
}

/** Contenu d'un brouillon : remplacé en entier à chaque enregistrement (lignes comprises). */
export class FactureDraftDto {
  @ApiProperty()
  @IsUUID()
  clientId: string;

  @ApiPropertyOptional({ description: 'Objet du document' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  subject?: string | null;

  @ApiPropertyOptional({ description: 'Référence de la commande du client' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  clientReference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Conditions (paiement, livraison, garantie…)' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  terms?: string | null;

  @ApiPropertyOptional({ description: 'Motif d’exonération, exigé si une ligne est à 0 %' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  vatExemptionReason?: string | null;

  @ApiPropertyOptional({ description: 'Validité d’un devis ou d’une pro forma (jours)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(1)
  @Max(365)
  validityDays?: number | null;

  @ApiPropertyOptional({ description: 'Facture : délai de paiement (jours après l’émission)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsInt()
  @Min(0)
  @Max(FACTURE_MAX_PAYMENT_TERMS_DAYS)
  paymentTermsDays?: number | null;

  @ApiProperty({ type: [FactureLineDto] })
  @IsArray()
  @ArrayMaxSize(FACTURE_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => FactureLineDto)
  lines: FactureLineDto[];
}

export class CreateFactureDocumentDto extends FactureDraftDto {
  @ApiProperty({ enum: FACTURE_CREATABLE_TYPES })
  @IsIn(FACTURE_CREATABLE_TYPES)
  type: FactureCreatableType;
}

export class FactureDocumentQueryDto {
  @ApiPropertyOptional({ enum: FACTURE_DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(FACTURE_DOCUMENT_TYPES)
  type?: FactureDocumentType;

  @ApiPropertyOptional({ enum: FACTURE_DOCUMENT_STATUSES })
  @IsOptional()
  @IsIn(FACTURE_DOCUMENT_STATUSES)
  status?: FactureDocumentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;
}

export class ConvertFactureDocumentDto {
  @ApiProperty({ enum: ['PRO_FORMA', 'ORDER', 'INVOICE'] })
  @IsIn(['PRO_FORMA', 'ORDER', 'INVOICE'])
  type: 'PRO_FORMA' | 'ORDER' | 'INVOICE';
}

export class CancelFactureDocumentDto {
  @ApiProperty({ description: 'Motif de l’annulation' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

export class SendFactureDocumentDto {
  @ApiPropertyOptional({ description: 'Destinataire ; à défaut, l’e-mail du client' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || undefined : value,
  )
  @IsEmail()
  @MaxLength(160)
  to?: string;

  @ApiPropertyOptional({ description: 'Message personnalisé' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000)
  message?: string | null;
}

// ─── Facturation (F2) ───

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class RecordFacturePaymentDto {
  @ApiProperty({ description: 'Montant encaissé, en FCFA entiers' })
  @IsInt()
  @Min(1)
  @Max(FACTURE_MAX_DOCUMENT_TOTAL)
  amount: number;

  @ApiProperty({ enum: FACTURE_PAYMENT_METHODS })
  @IsIn(FACTURE_PAYMENT_METHODS)
  method: FacturePaymentMethod;

  @ApiProperty({ description: 'Date de l’encaissement (AAAA-MM-JJ), au plus tard aujourd’hui' })
  @Matches(ISO_DAY)
  @IsISO8601({ strict: true })
  paidAt: string;

  @ApiPropertyOptional({ description: 'N° de chèque, de virement ou de transaction' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CancelFacturePaymentDto {
  @ApiProperty({ description: 'Motif de l’annulation de l’encaissement' })
  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason: string;
}

/** Période d'un export (dates incluses, un an au plus). */
export class FactureExportQueryDto {
  @ApiProperty({ description: 'Premier jour (AAAA-MM-JJ)' })
  @Matches(ISO_DAY)
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ description: 'Dernier jour (AAAA-MM-JJ)' })
  @Matches(ISO_DAY)
  @IsISO8601({ strict: true })
  to: string;
}
