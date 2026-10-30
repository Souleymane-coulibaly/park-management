import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import {
  DINING_QR_TOKEN_PATTERN,
  DINING_ZONE_KINDS,
  type DiningZoneKind,
  MAX_NOTE_LENGTH,
  MAX_QR_LINES,
  MAX_QR_LINE_QUANTITY,
  MAX_SALE_LINES,
  QR_ORDER_STATUSES,
  type QrOrderStatus,
  STAFF_ORDER_CHANNELS,
  type StaffOrderChannel,
} from '@ocall/shared';
import { CartLineDto } from '../pos/pos.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Chaîne vide → null : permet d'effacer un champ facultatif. */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// ─── Commandes ───

export class CreateOrderDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ enum: STAFF_ORDER_CHANNELS, example: 'DINE_IN' })
  @IsIn(STAFF_ORDER_CHANNELS)
  channel: StaffOrderChannel;

  @ApiPropertyOptional({ description: 'Table (sur place).' })
  @IsOptional()
  @IsUUID('4')
  tableId?: string;

  @ApiPropertyOptional({ description: 'Zone sans table précise (ex. bord de piscine).' })
  @IsOptional()
  @IsUUID('4')
  zoneId?: string;

  @ApiPropertyOptional({ description: 'Instructions pour toute la commande.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  notes?: string | null;

  @ApiProperty({ type: [CartLineDto], description: 'Variantes et quantités : jamais de prix.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];

  @ApiPropertyOptional({ description: 'Clé d’idempotence : un renvoi ne crée pas de doublon.' })
  @IsOptional()
  @IsUUID('4')
  clientRequestId?: string;
}

/** Modification d'une commande non payée. Champ absent = inchangé ; null = effacé. */
export class UpdateOrderDto {
  @ApiPropertyOptional({ type: [CartLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines?: CartLineDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  tableId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  zoneId?: string | null;
}

export class OrdersQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional({
    enum: ['active', 'today'],
    description: 'active : non servies ou non payées ; today : toutes celles du jour.',
  })
  @IsOptional()
  @IsIn(['active', 'today'])
  view?: 'active' | 'today';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  tableId?: string;
}

// ─── Commandes par QR code ───

export class QrRequestsQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional({ enum: QR_ORDER_STATUSES })
  @IsOptional()
  @IsIn(QR_ORDER_STATUSES)
  status?: QrOrderStatus;
}

export class RejectQrRequestDto {
  @ApiProperty({ example: 'Article épuisé' })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason: string;
}

export class PublicOrderLineDto {
  @ApiProperty()
  @IsUUID('4')
  variantId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_QR_LINE_QUANTITY)
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  notes?: string;
}

/** Demande de commande d'un client (page publique) : aucun prix, aucun identifiant interne. */
export class PublicOrderDto {
  @ApiProperty({ type: [PublicOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QR_LINES)
  @ValidateNested({ each: true })
  @Type(() => PublicOrderLineDto)
  lines: PublicOrderLineDto[];

  @ApiPropertyOptional({ description: 'Prénom ou surnom, facultatif.' })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  customerName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  notes?: string | null;

  @ApiProperty({ description: 'Clé d’idempotence générée par la page du client.' })
  @IsUUID('4')
  clientRequestId: string;
}

export class QrTokenParam {
  @ApiProperty()
  @Matches(DINING_QR_TOKEN_PATTERN)
  token: string;
}

// ─── Salles, zones et tables ───

export class EstablishmentQuery {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}

export class CreateZoneDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Terrasse' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ enum: DINING_ZONE_KINDS })
  @IsIn(DINING_ZONE_KINDS)
  kind: DiningZoneKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class UpdateZoneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional({ enum: DINING_ZONE_KINDS })
  @IsOptional()
  @IsIn(DINING_ZONE_KINDS)
  kind?: DiningZoneKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTableDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  zoneId?: string;

  @ApiProperty({ example: 'Table 4' })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  seats?: number;
}

export class UpdateTableDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  zoneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  seats?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
