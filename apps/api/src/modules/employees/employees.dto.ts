import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { MEMBER_ROLES, type MemberRole } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Une chaîne vide efface l'e-mail facultatif. */
const optionalEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim().toLowerCase()) : value;

export class CreateEmployeeDto {
  @ApiProperty({ example: 'Moussa' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  firstName: string;

  @ApiProperty({ example: 'Diarra' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  lastName: string;

  @ApiPropertyOptional({
    description: 'Facultatif : permet la réinitialisation autonome du mot de passe.',
  })
  @IsOptional()
  @Transform(optionalEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiProperty({ enum: MEMBER_ROLES })
  @IsIn(MEMBER_ROLES)
  role: MemberRole;

  @ApiProperty({
    type: [String],
    description: "Établissements autorisés (de l'organisation courante).",
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  establishmentIds: string[];
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  lastName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(optionalEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: MEMBER_ROLES })
  @IsIn(MEMBER_ROLES)
  role: MemberRole;
}

export class SetAssignmentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  establishmentIds: string[];
}
