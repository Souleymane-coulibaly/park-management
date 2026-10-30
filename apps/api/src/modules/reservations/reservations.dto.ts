import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
  MAX_NOTE_LENGTH,
  MAX_PARTY_SIZE,
  MAX_RESERVATION_MINUTES,
  MIN_RESERVATION_MINUTES,
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/** Téléphone facultatif : chiffres, espaces, +, tirets et points (format libre, international). */
const PHONE = /^\+?[0-9 .-]{6,20}$/;

export class CreateReservationDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Mariam Diallo' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  customerName: string;

  @ApiPropertyOptional({ example: '+223 70 00 00 00' })
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(PHONE, { message: 'Numéro de téléphone invalide.' })
  customerPhone?: string | null;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(MAX_PARTY_SIZE)
  partySize: number;

  @ApiProperty({ example: '2026-11-02T19:30:00.000Z' })
  @IsISO8601({ strict: true })
  startsAt: string;

  @ApiPropertyOptional({ example: 90 })
  @IsOptional()
  @IsInt()
  @Min(MIN_RESERVATION_MINUTES)
  @Max(MAX_RESERVATION_MINUTES)
  durationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  tableId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  zoneId?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'CONFIRMED'] })
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED'])
  status?: 'PENDING' | 'CONFIRMED';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  notes?: string | null;
}

export class UpdateReservationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  customerName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(PHONE, { message: 'Numéro de téléphone invalide.' })
  customerPhone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PARTY_SIZE)
  partySize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(MIN_RESERVATION_MINUTES)
  @Max(MAX_RESERVATION_MINUTES)
  durationMinutes?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  tableId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  zoneId?: string | null;

  @ApiPropertyOptional({ enum: RESERVATION_STATUSES })
  @IsOptional()
  @IsIn(RESERVATION_STATUSES)
  status?: ReservationStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  notes?: string | null;
}

export class ReservationsQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional({ example: '2026-11-02T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;
}
