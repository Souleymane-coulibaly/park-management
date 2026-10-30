import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_AMOUNT } from '@ocall/shared';

/** Photo : chaîne vide → null (suppression de la photo). */
const trimOrNullImage = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCategoryDto {
  @ApiProperty({ example: 'Boissons' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;

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

/** Tarif d'une variante dans un établissement : entier en FCFA, TTC. */
export class VariantPriceDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 1500 })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  price: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class VariantDto {
  @ApiPropertyOptional({ description: 'Absent pour une nouvelle variante.' })
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @ApiProperty({ example: 'Standard' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [VariantPriceDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VariantPriceDto)
  prices: VariantPriceDto[];
}

export class CreateProductDto {
  @ApiProperty({ example: 'Jus de bissap' })
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

  @ApiPropertyOptional({ description: 'Photo du produit : URL https (500 caractères au plus).' })
  @IsOptional()
  @Transform(trimOrNullImage)
  @Matches(/^https:\/\/\S{4,492}$/, { message: 'La photo doit être une adresse https.' })
  imageUrl?: string | null;

  @ApiProperty()
  @IsUUID('4')
  categoryId: string;

  @ApiProperty({ type: [VariantDto], description: 'Au moins une variante (ex. « Standard »).' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ description: 'Photo du produit : URL https (500 caractères au plus).' })
  @IsOptional()
  @Transform(trimOrNullImage)
  @Matches(/^https:\/\/\S{4,492}$/, { message: 'La photo doit être une adresse https.' })
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [VariantDto],
    description:
      'Liste complète des variantes. Une variante existante absente de la liste est désactivée (jamais supprimée).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}
