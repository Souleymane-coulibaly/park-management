import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { KIOSK_PAIRING_ALPHABET, KIOSK_PAIRING_CODE_LENGTH } from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : value;

export class CreateKioskDeviceDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Borne entrée' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;
}

export class KioskDevicesQueryDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;
}

export class PairKioskDto {
  @ApiProperty({
    example: 'ABCD2345',
    description: 'Code d’appairage affiché dans l’administration.',
  })
  @Transform(upper)
  @Matches(new RegExp(`^[${KIOSK_PAIRING_ALPHABET}]{${KIOSK_PAIRING_CODE_LENGTH}}$`), {
    message: 'Code d’appairage invalide.',
  })
  code: string;
}
