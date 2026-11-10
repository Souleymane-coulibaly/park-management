import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, ValidateIf } from 'class-validator';
import { FACTURE_REMINDER_HOURS } from '@ocall/shared';

/** Réglages des notifications de rendez-vous (F4). */
export class FactureNotificationSettingsDto {
  @ApiProperty({ description: 'Notifications de rendez-vous activées' })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ description: 'Confirmation envoyée dès la planification' })
  @IsBoolean()
  sendConfirmation: boolean;

  @ApiProperty({ description: 'Rappel la veille (24 h avant)' })
  @IsBoolean()
  reminderDayBefore: boolean;

  @ApiPropertyOptional({
    description: 'Rappel quelques heures avant (null : aucun)',
    enum: FACTURE_REMINDER_HOURS,
    nullable: true,
  })
  @ValidateIf((_, v) => v !== null)
  @IsIn(FACTURE_REMINDER_HOURS)
  reminderHoursBefore: number | null;

  @ApiProperty({ description: 'E-mail en secours quand WhatsApp est impossible' })
  @IsBoolean()
  emailFallback: boolean;
}
