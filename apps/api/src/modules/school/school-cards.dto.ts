import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  PRINT_BATCH_MAX,
  PRINT_CARD_KINDS,
  PRINT_ORDER_MAX_ITEMS,
  PRINT_ORDER_STATUSES,
  type PrintCardKind,
  type PrintOrderStatus,
  SCHOOL_STAFF_CATEGORIES,
  type SchoolStaffCategory,
} from '@ocall/shared';

export class CardTemplateCreateDto {
  @ApiProperty() @IsUUID('4') schoolId!: string;
  @ApiProperty() @IsString() @MaxLength(80) name!: string;
  @ApiProperty({ enum: PRINT_CARD_KINDS }) @IsIn(PRINT_CARD_KINDS) kind!: PrintCardKind;
  @ApiProperty() @IsObject() layout!: Record<string, unknown>;
}

export class CardTemplateUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() layout?: Record<string, unknown>;
}

export class CardsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') schoolId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') holderId?: string;
  @ApiPropertyOptional({ enum: PRINT_CARD_KINDS })
  @IsOptional()
  @IsIn(PRINT_CARD_KINDS)
  kind?: PrintCardKind;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'REVOKED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'REVOKED'])
  status?: 'ACTIVE' | 'REVOKED';
}

export class IssueStudentCardsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_BATCH_MAX)
  @IsUUID('4', { each: true })
  studentIds!: string[];
}

export class IssueClassCardsDto {
  @ApiProperty() @IsUUID('4') schoolYearId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') classId?: string | null;
}

export class IssueStaffCardsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_BATCH_MAX)
  @IsUUID('4', { each: true })
  staffIds!: string[];
}

export class CardReasonDto {
  @ApiProperty() @IsString() @MaxLength(200) reason!: string;
}

export class CardQrDto {
  @ApiProperty() @IsString() @MaxLength(200) qr!: string;
}

export class CardPreviewQueryDto {
  @ApiProperty() @IsUUID('4') templateId!: string;
}

export class CardPhotoDto {
  @ApiProperty({ nullable: true })
  @IsOptional()
  @IsUUID('4')
  documentId!: string | null;
}

export class CardDeliveryDto {
  @ApiProperty() @IsString() @MaxLength(300) address!: string;
  @ApiProperty() @IsString() @MaxLength(120) contactName!: string;
  @ApiProperty() @IsString() @MaxLength(30) contactPhone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class CardOrderDto {
  @ApiProperty() @IsUUID('4') schoolId!: string;
  @ApiProperty() @IsUUID('4') templateId!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_ORDER_MAX_ITEMS)
  @IsUUID('4', { each: true })
  cardIds!: string[];
  @ApiProperty() @ValidateNested() @Type(() => CardDeliveryDto) delivery!: CardDeliveryDto;
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{8,100}$/) idempotencyKey!: string;
}

export class CardOrdersQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') schoolId?: string;
  @ApiPropertyOptional({ enum: PRINT_ORDER_STATUSES })
  @IsOptional()
  @IsIn(PRINT_ORDER_STATUSES)
  status?: PrintOrderStatus;
}

export class StaffDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') schoolId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastNameAr?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstNameAr?: string | null;
  @ApiPropertyOptional({ enum: SCHOOL_STAFF_CATEGORIES })
  @IsOptional()
  @IsIn(SCHOOL_STAFF_CATEGORIES)
  category?: SchoolStaffCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) jobTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') memberId?: string | null;
}

export class StaffQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') schoolId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) q?: string;
  @ApiPropertyOptional({ enum: SCHOOL_STAFF_CATEGORIES })
  @IsOptional()
  @IsIn(SCHOOL_STAFF_CATEGORIES)
  category?: SchoolStaffCategory;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false';
}

export class StaffActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class StaffImportMembersDto {
  @ApiProperty() @IsUUID('4') schoolId!: string;
}

export class PrintImportDto {
  @ApiProperty() @IsUUID('4') schoolId!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PRINT_BATCH_MAX)
  @IsUUID('all', { each: true })
  personIds!: string[];
}
