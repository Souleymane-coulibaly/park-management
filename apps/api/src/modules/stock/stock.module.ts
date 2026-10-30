import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import {
  CreateStockItemDto,
  CreateStockMovementDto,
  MovementsQueryDto,
  PutRecipeDto,
  StockQueryDto,
  UpdateStockItemDto,
} from './stock.dto';
import { StockService } from './stock.service';

@ApiTags('Restaurant — stocks')
@RequireActivity('RESTAURANT')
@Controller('stock')
class StockController {
  constructor(private readonly stock: StockService) {}

  /** Articles avec quantité, seuil et indicateur d'alerte. */
  @RequirePermission('stock.read')
  @Get('items')
  list(@CurrentAuth() auth: AuthContext, @Query() q: StockQueryDto) {
    return this.stock.list(requireTenant(auth), q.establishmentId);
  }

  @RequirePermission('stock.manage')
  @Post('items')
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateStockItemDto) {
    return this.stock.create(requireTenant(auth), dto);
  }

  @RequirePermission('stock.manage')
  @Patch('items/:id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockItemDto,
  ) {
    return this.stock.update(requireTenant(auth), id, dto);
  }

  /** Entrée ou sortie (stock.move), ajustement d'inventaire (stock.manage, vérifié par le service). */
  @RequirePermission('stock.move')
  @Post('movements')
  move(@CurrentAuth() auth: AuthContext, @Body() dto: CreateStockMovementDto) {
    return this.stock.move(requireTenant(auth), dto);
  }

  @RequirePermission('stock.read')
  @Get('movements')
  movements(@CurrentAuth() auth: AuthContext, @Query() q: MovementsQueryDto) {
    return this.stock.movements(requireTenant(auth), q);
  }

  @RequirePermission('stock.read')
  @Get('recipes')
  recipes(@CurrentAuth() auth: AuthContext, @Query() q: StockQueryDto) {
    return this.stock.recipes(requireTenant(auth), q.establishmentId);
  }

  @RequirePermission('stock.manage')
  @Put('recipes/:variantId')
  putRecipe(
    @CurrentAuth() auth: AuthContext,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: PutRecipeDto,
  ) {
    return this.stock.putRecipe(requireTenant(auth), variantId, dto);
  }
}

/** Stocks, mouvements et recettes. La consommation par les ventes vit dans StockConsumptionModule. */
@Module({
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
