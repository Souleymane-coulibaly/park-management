import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MAX_AMOUNT,
  MAX_PEOPLE_PER_TICKET,
  MAX_VISITORS_PER_ORDER,
  TICKET_KINDS,
  type TicketKind,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class EstablishmentQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}

export class CreateTicketCategoryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ enum: TICKET_KINDS })
  @IsIn(TICKET_KINDS)
  kind: TicketKind;

  @ApiProperty({ example: 'Adulte' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ description: 'Prix TTC en FCFA d’une unité (formule comprise).', example: 3000 })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  price: number;

  @ApiPropertyOptional({
    description: 'Billets individuels par unité (famille de 5 = 5).',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PEOPLE_PER_TICKET)
  peopleIncluded?: number;

  @ApiPropertyOptional({ example: 'Moins de 12 ans' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  conditions?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Début de la période de vente (inclus).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  availableFrom?: string | null;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Fin de la période de vente (incluse).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  availableUntil?: string | null;

  @ApiPropertyOptional({
    description: 'Durée de validité en jours à compter de la visite.',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  validityDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateTicketCategoryDto {
  @ApiPropertyOptional({ enum: TICKET_KINDS })
  @IsOptional()
  @IsIn(TICKET_KINDS)
  kind?: TicketKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PEOPLE_PER_TICKET)
  peopleIncluded?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  conditions?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  availableFrom?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  availableUntil?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(366)
  validityDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TicketOrderLineDto {
  @ApiProperty()
  @IsUUID('4')
  ticketCategoryId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_VISITORS_PER_ORDER)
  quantity: number;

  @ApiProperty({
    description: 'Un prénom par billet individuel (quantité × personnes incluses).',
    example: ['Awa'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_VISITORS_PER_ORDER)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  visitorNames: string[];
}

export class TicketQuoteDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ type: [TicketOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TicketOrderLineDto)
  lines: TicketOrderLineDto[];
}

export class CreateTicketOrderDto extends TicketQuoteDto {
  @ApiPropertyOptional({
    description: 'Clé d’idempotence : une nouvelle tentative renvoie la même vente.',
  })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}

export class WeeklyOpeningDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = dimanche … 6 = samedi' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  @ApiProperty()
  @IsBoolean()
  isClosed: boolean;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @Matches(TIME)
  opensAt?: string | null;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @Matches(TIME)
  closesAt?: string | null;
}

export class PutWeeklyScheduleDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({
    type: [WeeklyOpeningDto],
    description: 'Liste complète (0 à 7 jours). Vide = sans restriction.',
  })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyOpeningDto)
  days: WeeklyOpeningDto[];
}

export class CreateCalendarExceptionDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: '2026-12-25' })
  @IsISO8601({ strict: true })
  date: string;

  @ApiProperty()
  @IsBoolean()
  isClosed: boolean;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @Matches(TIME)
  opensAt?: string | null;

  @ApiPropertyOptional({ example: '23:00' })
  @IsOptional()
  @Matches(TIME)
  closesAt?: string | null;

  @ApiPropertyOptional({ example: 'Nocturne de Noël' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  label?: string;
}

export class ScanTicketDto {
  @ApiProperty({ description: 'Établissement du point de contrôle.' })
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Entrée principale' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  entryPoint: string;

  @ApiProperty({ description: 'Contenu brut du QR code scanné.' })
  @IsString()
  @MaxLength(512)
  qr: string;

  @ApiPropertyOptional({ description: 'Clé d’idempotence du scan.' })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}

export class ScansQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class TicketsQueryDto {
  @ApiProperty()
  @IsUUID('4')
  saleId: string;
}

export class CancelTicketDto {
  @ApiProperty({ example: 'Erreur de saisie du prénom' })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason: string;
}
