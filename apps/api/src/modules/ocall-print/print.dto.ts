import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PRINT_BATCH_MAX,
  PRINT_CARD_KINDS,
  PRINT_ORDER_MAX_ITEMS,
  PRINT_ORDER_STATUSES,
  type PrintCardKind,
  type PrintOrderStatus,
} from '@ocall/shared';

export class PrintTemplateCreateDto {
  @ApiProperty() @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ enum: PRINT_CARD_KINDS }) @IsIn(PRINT_CARD_KINDS) kind!: PrintCardKind;
  /** Mise en page : validée par le moteur (forme fermée), refusée au moindre écart. */
  @ApiProperty() @IsObject() layout!: Record<string, unknown>;
}

export class PrintTemplateUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() layout?: Record<string, unknown>;
}

export class PrintReasonDto {
  @ApiProperty() @IsString() @MaxLength(200) reason!: string;
}

export class PrintQrDto {
  @ApiProperty() @IsString() @MaxLength(200) qr!: string;
}

export class PrintDeliveryDto {
  @ApiProperty() @IsString() @MaxLength(300) address!: string;
  @ApiProperty() @IsString() @MaxLength(120) contactName!: string;
  @ApiProperty() @IsString() @MaxLength(30) contactPhone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class PrintOrderCreateDto {
  @ApiProperty() @IsUUID() templateId!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_ORDER_MAX_ITEMS)
  @IsUUID('all', { each: true })
  cardIds!: string[];
  @ApiProperty() @ValidateNested() @Type(() => PrintDeliveryDto) delivery!: PrintDeliveryDto;
  /** Identifiant d'envoi choisi par le navigateur : un nouvel envoi après coupure ne crée rien de plus. */
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{8,100}$/) idempotencyKey!: string;
}

export class PrintOrdersQueryDto {
  @ApiPropertyOptional({ enum: PRINT_ORDER_STATUSES })
  @IsOptional()
  @IsIn(PRINT_ORDER_STATUSES)
  status?: PrintOrderStatus;
}

export class PrintPersonDto {
  @ApiPropertyOptional({ enum: PRINT_CARD_KINDS })
  @IsOptional()
  @IsIn(PRINT_CARD_KINDS)
  kind?: PrintCardKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastNameAr?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstNameAr?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) reference?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) groupLabel?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) jobTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) birthDate?: string | null;
}

export class PrintPersonsQueryDto {
  @ApiPropertyOptional({ enum: PRINT_CARD_KINDS })
  @IsOptional()
  @IsIn(PRINT_CARD_KINDS)
  kind?: PrintCardKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) archived?: 'true' | 'false';
}

export class PrintIssueCardsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_BATCH_MAX)
  @IsUUID('all', { each: true })
  personIds!: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil?: string | null;
}

export class PrintAdvanceDto {
  @ApiProperty({ enum: ['ACCEPTED', 'IN_PRODUCTION', 'READY', 'DELIVERED'] })
  @IsIn(['ACCEPTED', 'IN_PRODUCTION', 'READY', 'DELIVERED'])
  status!: PrintOrderStatus;
}

export class PrintPaymentDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) amount!: number;
  @ApiProperty() @IsString() @MaxLength(60) reference!: string;
}

export class PrintQueueQueryDto {
  @ApiPropertyOptional({ enum: PRINT_ORDER_STATUSES })
  @IsOptional()
  @IsIn(PRINT_ORDER_STATUSES)
  status?: PrintOrderStatus;
}
