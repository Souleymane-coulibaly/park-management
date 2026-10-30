import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { STAFF_POSITION_KINDS, type StaffPositionKind } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class CreatePositionDto {
  @ApiProperty({ example: 'Bar' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ enum: STAFF_POSITION_KINDS })
  @IsIn(STAFF_POSITION_KINDS)
  kind: StaffPositionKind;
}

export class UpdatePositionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateAssignmentDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ description: 'Adhésion (employé) affectée.' })
  @IsUUID('4')
  membershipId: string;

  @ApiProperty()
  @IsUUID('4')
  positionId: string;

  @ApiProperty({ example: '2026-11-02T08:00:00.000Z' })
  @IsISO8601({ strict: true })
  startsAt: string;

  @ApiProperty({ example: '2026-11-02T16:00:00.000Z' })
  @IsISO8601({ strict: true })
  endsAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  notes?: string | null;
}

export class UpdateAssignmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  membershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  positionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  notes?: string | null;
}

export class PlanningRangeDto {
  @ApiProperty({ example: '2026-11-02T00:00:00.000Z' })
  @IsISO8601()
  from: string;

  @ApiProperty({ example: '2026-11-09T00:00:00.000Z' })
  @IsISO8601()
  to: string;
}

export class AssignmentsQueryDto extends PlanningRangeDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}

export class EstablishmentParamQuery {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}
