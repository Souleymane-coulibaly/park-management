import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { DiningService } from './dining.service';
import { RestaurantOrdersService } from './orders.service';
import { QrOrdersService } from './qr-orders.service';
import { RestaurantDashboardService } from './restaurant-dashboard.service';
import {
  DiningController,
  KitchenController,
  OrdersController,
  PublicOrderingController,
} from './restaurant.controllers';

/**
 * Restaurant : commandes (sur place, à emporter, comptoir, QR), cuisine KDS en temps réel, salles et
 * tables, tableau de bord. Construit sur le moteur de vente commun (PosModule) : aucune seconde
 * logique de prix ou de paiement.
 */
@Module({
  imports: [PosModule],
  controllers: [OrdersController, KitchenController, DiningController, PublicOrderingController],
  providers: [DiningService, RestaurantOrdersService, QrOrdersService, RestaurantDashboardService],
  // Les réservations réutilisent le contrôle des tables et des zones.
  exports: [DiningService],
})
export class RestaurantModule {}
