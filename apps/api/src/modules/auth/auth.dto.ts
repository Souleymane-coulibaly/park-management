import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import {
  BUSINESS_TYPES,
  type BusinessType,
  PASSWORD_MAX_LENGTH,
  SUPPORTED_COUNTRIES,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class SignupDto {
  @ApiProperty({ example: 'Aqua Splash Bamako' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  organizationName: string;

  @ApiProperty({ enum: BUSINESS_TYPES })
  @IsIn(BUSINESS_TYPES)
  businessType: BusinessType;

  @ApiProperty({ example: 'ML', enum: SUPPORTED_COUNTRIES.map((c) => c.code) })
  @IsIn(SUPPORTED_COUNTRIES.map((c) => c.code))
  countryCode: string;

  @ApiProperty({ example: 'Aqua Splash — ACI 2000' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  establishmentName: string;

  @ApiProperty({ example: 'Awa' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  firstName: string;

  @ApiProperty({ example: 'Traoré' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  lastName: string;

  @ApiProperty({ example: 'awa@aquasplash.ml' })
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class LoginDto {
  @ApiProperty({ description: 'E-mail ou identifiant employé (ex. AQUASP-0002).' })
  @Transform(trim)
  @IsString()
  @Length(1, 254)
  identifier: string;

  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class PasswordResetRequestDto {
  @ApiProperty({ description: 'E-mail ou identifiant.' })
  @Transform(trim)
  @IsString()
  @Length(1, 254)
  identifier: string;
}

export class PasswordResetConfirmDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  token: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class UpdateProfileDto {
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
}
