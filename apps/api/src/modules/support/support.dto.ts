import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import {
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from '@ocall/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Champs multipart : les booléens arrivent en texte. */
const bool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;
const empty = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

export class CreateTicketDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(4, 140)
  subject: string;

  @ApiProperty({ enum: SUPPORT_TICKET_CATEGORIES })
  @IsIn(SUPPORT_TICKET_CATEGORIES)
  category: SupportTicketCategory;

  @ApiPropertyOptional({ enum: SUPPORT_TICKET_PRIORITIES })
  @Transform(empty)
  @IsOptional()
  @IsIn(SUPPORT_TICKET_PRIORITIES)
  priority?: SupportTicketPriority;

  @ApiPropertyOptional()
  @Transform(empty)
  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(10, 5000)
  body: string;
}

export class ReplyTicketDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 5000)
  body: string;
}

export class OcallReplyDto extends ReplyTicketDto {
  @ApiPropertyOptional({ description: 'Note interne : jamais visible par le client.' })
  @Transform(bool)
  @IsOptional()
  @IsBoolean()
  internal?: boolean;

  @ApiPropertyOptional({ enum: SUPPORT_TICKET_STATUSES })
  @Transform(empty)
  @IsOptional()
  @IsIn(SUPPORT_TICKET_STATUSES)
  status?: SupportTicketStatus;
}

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: SUPPORT_TICKET_STATUSES })
  @IsOptional()
  @IsIn(SUPPORT_TICKET_STATUSES)
  status?: SupportTicketStatus;

  @ApiPropertyOptional({ enum: SUPPORT_TICKET_PRIORITIES })
  @IsOptional()
  @IsIn(SUPPORT_TICKET_PRIORITIES)
  priority?: SupportTicketPriority;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;
}

export class TicketsQueryDto {
  @ApiPropertyOptional({ enum: SUPPORT_TICKET_STATUSES })
  @IsOptional()
  @IsIn(SUPPORT_TICKET_STATUSES)
  status?: SupportTicketStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  product?: string;

  @ApiPropertyOptional()
  @Transform(bool)
  @IsOptional()
  @IsBoolean()
  mine?: boolean;
}
