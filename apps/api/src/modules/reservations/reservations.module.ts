import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import { RestaurantModule } from '../restaurant/restaurant.module';
import {
  CreateReservationDto,
  ReservationsQueryDto,
  UpdateReservationDto,
} from './reservations.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('Restaurant — réservations')
@RequireActivity('RESTAURANT')
@Controller('reservations')
class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** Réservations sur une période (par défaut : aujourd'hui et les 7 jours suivants). */
  @RequirePermission('reservation.manage')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() q: ReservationsQueryDto) {
    return this.reservations.list(requireTenant(auth), q);
  }

  @RequirePermission('reservation.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateReservationDto) {
    return this.reservations.create(requireTenant(auth), dto);
  }

  @RequirePermission('reservation.manage')
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservations.update(requireTenant(auth), id, dto);
  }
}

@Module({
  imports: [RestaurantModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
