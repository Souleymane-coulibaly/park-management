import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_NOTE_LENGTH,
  MAX_SALE_LINES,
  STAFF_ORDER_CHANNELS,
  type StaffOrderChannel,
} from '@ocall/shared';
import { CartLineDto } from '../../pos/pos.dto';

export class CreateVoiceOrderDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}

/** Panier vérifié par l'employé : variantes et quantités, jamais de prix (calculés par le serveur). */
export class ConfirmVoiceOrderDto {
  @ApiProperty({ enum: STAFF_ORDER_CHANNELS, example: 'DINE_IN' })
  @IsIn(STAFF_ORDER_CHANNELS)
  channel: StaffOrderChannel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  tableId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  notes?: string | null;

  @ApiProperty({ type: [CartLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];
}
