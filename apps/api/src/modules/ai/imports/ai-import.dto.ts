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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_AMOUNT, MAX_PEOPLE_PER_TICKET, TICKET_KINDS, type TicketKind } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const ACTIONS = ['CREATE', 'SKIP'] as const;

export class AnalyzeImportDto {
  @ApiProperty({
    description: 'Établissement dont la carte (ou la grille tarifaire) est importée.',
  })
  @IsUUID('4')
  establishmentId: string;
}

export class PublishVariantDto {
  @ApiProperty({ example: 'Standard' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ example: 2500, description: 'Prix vérifié par l’utilisateur, en FCFA.' })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  price: number;
}

/** Ligne de carte relue par l'utilisateur : seule une ligne « CREATE » est publiée. */
export class PublishCatalogLineDto {
  @ApiProperty({ description: 'Numéro de la ligne dans le résultat de l’analyse.' })
  @IsInt()
  @Min(0)
  index: number;

  @ApiProperty({ enum: ACTIONS })
  @IsIn(ACTIONS)
  action: (typeof ACTIONS)[number];

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ example: 'Plats', description: 'Catégorie existante ou à créer.' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  category: string;

  @ApiProperty({ type: [PublishVariantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PublishVariantDto)
  variants: PublishVariantDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class PublishCatalogDto {
  @ApiProperty({ type: [PublishCatalogLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PublishCatalogLineDto)
  lines: PublishCatalogLineDto[];
}

/** Tarif de billet relu par l'utilisateur ; publié DÉSACTIVÉ, à activer explicitement. */
export class PublishTicketLineDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  index: number;

  @ApiProperty({ enum: ACTIONS })
  @IsIn(ACTIONS)
  action: (typeof ACTIONS)[number];

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ enum: TICKET_KINDS })
  @IsIn(TICKET_KINDS)
  kind: TicketKind;

  @ApiProperty({ example: 3000 })
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
}

export class PublishTicketsDto {
  @ApiProperty({ type: [PublishTicketLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PublishTicketLineDto)
  lines: PublishTicketLineDto[];
}
