import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
} from 'class-validator';
import {
  MAX_AMOUNT,
  MAX_PEOPLE_PER_TICKET,
  PARK_EVENT_LIMITS,
  PARK_EVENT_STATUSES,
  type ParkEventStatus,
  TICKET_KINDS,
  type TicketKind,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ParkEventsQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional({ description: 'Inclure les événements archivés.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;
}

export class CreateParkEventDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Concert de Noël' })
  @Transform(trim)
  @IsString()
  @Length(1, PARK_EVENT_LIMITS.name)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(PARK_EVENT_LIMITS.description)
  description?: string;

  @ApiPropertyOptional({ example: 'Interdit aux moins de 6 ans' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(PARK_EVENT_LIMITS.conditions)
  conditions?: string;

  @ApiPropertyOptional({ default: 60, description: 'Entrée acceptée N minutes avant le début.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PARK_EVENT_LIMITS.maxToleranceMinutes)
  entryOpensBeforeMinutes?: number;

  @ApiPropertyOptional({ default: 0, description: 'Entrée acceptée N minutes après la fin.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PARK_EVENT_LIMITS.maxToleranceMinutes)
  entryClosesAfterMinutes?: number;

  @ApiPropertyOptional({ default: true, description: 'Agenda du site vitrine (si publié).' })
  @IsOptional()
  @IsBoolean()
  showOnSite?: boolean;
}

export class UpdateParkEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, PARK_EVENT_LIMITS.name)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(PARK_EVENT_LIMITS.description)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(PARK_EVENT_LIMITS.conditions)
  conditions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PARK_EVENT_LIMITS.maxToleranceMinutes)
  entryOpensBeforeMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PARK_EVENT_LIMITS.maxToleranceMinutes)
  entryClosesAfterMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showOnSite?: boolean;

  @ApiPropertyOptional({ enum: PARK_EVENT_STATUSES })
  @IsOptional()
  @IsIn(PARK_EVENT_STATUSES)
  status?: ParkEventStatus;
}

export class CreateEventSessionDto {
  @ApiProperty({ example: '2026-12-24' })
  @IsISO8601({ strict: true })
  @Matches(DAY)
  date: string;

  @ApiProperty({ example: '20:00' })
  @Matches(TIME)
  startTime: string;

  @ApiProperty({ example: '23:30', description: 'Antérieure au début = lendemain.' })
  @Matches(TIME)
  endTime: string;

  @ApiProperty({ example: 500, description: 'Places (billets individuels).' })
  @IsInt()
  @Min(1)
  @Max(PARK_EVENT_LIMITS.maxCapacity)
  capacity: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  salesOpen?: boolean;
}

export class UpdateEventSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DAY)
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME)
  startTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TIME)
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PARK_EVENT_LIMITS.maxCapacity)
  capacity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  salesOpen?: boolean;
}

export class CancelEventSessionDto {
  @ApiProperty({ example: 'Intempéries' })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason: string;
}

export class CreateEventTariffDto {
  @ApiProperty({ enum: TICKET_KINDS })
  @IsIn(TICKET_KINDS)
  kind: TicketKind;

  @ApiProperty({ example: 'Standard' })
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

  @ApiProperty({ example: 5000 })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  price: number;

  @ApiPropertyOptional({ default: 1 })
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
  conditions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional({ description: 'Places maximales de ce tarif par séance (vide = aucune).' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PARK_EVENT_LIMITS.maxCapacity)
  sessionQuota?: number | null;

  @ApiPropertyOptional({ default: false, description: 'Billet nominatif : prénom obligatoire.' })
  @IsOptional()
  @IsBoolean()
  requiresVisitorName?: boolean;
}

export class UpdateEventTariffDto {
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
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'null = aucun quota propre au tarif.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PARK_EVENT_LIMITS.maxCapacity)
  sessionQuota?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresVisitorName?: boolean;
}
