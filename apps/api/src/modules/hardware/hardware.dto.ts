import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import {
  PAPER_WIDTHS,
  PRINTER_CONNECTIONS,
  type PaperWidth,
  type PrinterConnection,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateTerminalDto {
  @ApiProperty()
  @IsUUID('4')
  establishmentId: string;

  @ApiProperty({ example: 'Caisse 1' })
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({ enum: PRINTER_CONNECTIONS, default: 'NONE' })
  @IsOptional()
  @IsIn(PRINTER_CONNECTIONS)
  printerConnection?: PrinterConnection;

  @ApiPropertyOptional({ example: '192.168.1.50:9100' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  printerAddress?: string | null;

  @ApiPropertyOptional({ enum: PAPER_WIDTHS, default: 80 })
  @IsOptional()
  @IsIn(PAPER_WIDTHS)
  paperWidth?: PaperWidth;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  autoPrintReceipt?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  drawerEnabled?: boolean;

  @ApiPropertyOptional({ enum: [2, 5], default: 2 })
  @IsOptional()
  @IsIn([2, 5])
  drawerPin?: 2 | 5;
}

export class UpdateTerminalDto {
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

  @ApiPropertyOptional({ enum: PRINTER_CONNECTIONS })
  @IsOptional()
  @IsIn(PRINTER_CONNECTIONS)
  printerConnection?: PrinterConnection;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  printerAddress?: string | null;

  @ApiPropertyOptional({ enum: PAPER_WIDTHS })
  @IsOptional()
  @IsIn(PAPER_WIDTHS)
  paperWidth?: PaperWidth;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoPrintReceipt?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  drawerEnabled?: boolean;

  @ApiPropertyOptional({ enum: [2, 5] })
  @IsOptional()
  @IsIn([2, 5])
  drawerPin?: 2 | 5;
}

export class TerminalsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  establishmentId?: string;
}

export class CreatePrintJobDto {
  @ApiProperty()
  @IsUUID('4')
  terminalId: string;

  @ApiProperty({ enum: ['RECEIPT', 'REPRINT', 'TEST'] })
  @IsIn(['RECEIPT', 'REPRINT', 'TEST'])
  kind: 'RECEIPT' | 'REPRINT' | 'TEST';

  @ApiPropertyOptional({ description: 'Obligatoire pour un ticket ou une réimpression.' })
  @IsOptional()
  @IsUUID('4')
  saleId?: string;

  @ApiPropertyOptional({ description: 'Motif, obligatoire pour une réimpression.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  reason?: string;

  @ApiProperty({
    description: 'Clé d’idempotence : une nouvelle tentative réseau ne réimprime pas.',
  })
  @IsUUID('4')
  clientRequestId: string;
}

/** Résultat rapporté par l'appareil après envoi au matériel. */
export class HardwareResultDto {
  @ApiProperty({ enum: ['SUCCEEDED', 'FAILED'] })
  @IsIn(['SUCCEEDED', 'FAILED'])
  status: 'SUCCEEDED' | 'FAILED';

  @ApiPropertyOptional({ example: 'PRINTER_UNREACHABLE' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  errorCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  errorMessage?: string;
}

export class PrintJobsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  terminalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  saleId?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'SUCCEEDED', 'FAILED'] })
  @IsOptional()
  @IsIn(['PENDING', 'SUCCEEDED', 'FAILED'])
  status?: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export class CreateDrawerEventDto {
  @ApiProperty()
  @IsUUID('4')
  terminalId: string;

  @ApiProperty({ enum: ['CASH_PAYMENT', 'MANUAL'] })
  @IsIn(['CASH_PAYMENT', 'MANUAL'])
  reason: 'CASH_PAYMENT' | 'MANUAL';

  @ApiPropertyOptional({ description: 'Paiement en espèces confirmé (ouverture automatique).' })
  @IsOptional()
  @IsUUID('4')
  paymentId?: string;

  @ApiPropertyOptional({ description: 'Justification obligatoire pour une ouverture manuelle.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(5, 200)
  justification?: string;

  @ApiProperty()
  @IsUUID('4')
  clientRequestId: string;
}

export class DrawerEventsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  terminalId?: string;
}
