import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../prisma/prisma.service';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, Public, RequireActivity, RequirePermission } from '../../common/decorators';
import { SensitiveRoute } from '../../common/throttling';
import { loadSellableCatalog } from '../pos/sellable-catalog';
import { PublicOrderDto } from '../restaurant/restaurant.dto';
import { QrOrdersService } from '../restaurant/qr-orders.service';
import { RestaurantModule } from '../restaurant/restaurant.module';
import {
  CreateKioskDeviceDto,
  KioskDevicesQueryDto,
  KioskPrintResultDto,
  KioskPrinterDto,
  PairKioskDto,
} from './kiosk.dto';
import { type KioskContext, KioskService, UNPAIRED } from './kiosk.service';

/** Cookie du jeton d'appareil : httpOnly, limité aux routes de la borne. */
export const KIOSK_COOKIE = 'ocp_kiosk';
const KIOSK_COOKIE_PATH = '/api/v1/kiosk';

declare module 'express' {
  interface Request {
    kiosk?: KioskContext;
  }
}

/** Authentifie la borne par son cookie d'appareil (indépendant des sessions d'employés). */
@Injectable()
class KioskGuard implements CanActivate {
  constructor(private readonly kiosks: KioskService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token: unknown = req.cookies?.[KIOSK_COOKIE];
    const kiosk = typeof token === 'string' ? await this.kiosks.resolve(token) : null;
    if (!kiosk) throw new UnauthorizedException(UNPAIRED);
    req.kiosk = kiosk;
    return true;
  }
}

const CurrentKiosk = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().kiosk!,
);

/** Administration des bornes (propriétaire et administrateur). */
@ApiTags('Bornes de commande — administration')
@RequireActivity('RESTAURANT')
@Controller('kiosk-devices')
class KioskDevicesController {
  constructor(private readonly kiosks: KioskService) {}

  @RequirePermission('kiosk.manage')
  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() q: KioskDevicesQueryDto) {
    return this.kiosks.list(requireTenant(auth), q.establishmentId);
  }

  /** Création : renvoie le code d'appairage (affiché une seule fois, valable 15 minutes). */
  @RequirePermission('kiosk.manage')
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateKioskDeviceDto) {
    return this.kiosks.create(requireTenant(auth), dto.establishmentId, dto.name);
  }

  @RequirePermission('kiosk.manage')
  @HttpCode(200)
  @Post(':id/pairing-code')
  pairing(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.kiosks.newPairing(requireTenant(auth), id);
  }

  /** Imprimante des tickets de commande de la borne (poste du même établissement). */
  @RequirePermission('kiosk.manage')
  @HttpCode(200)
  @Post(':id/printer')
  printer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KioskPrinterDto,
  ) {
    return this.kiosks.setPrinter(requireTenant(auth), id, dto.terminalId ?? null);
  }

  @RequirePermission('kiosk.manage')
  @HttpCode(200)
  @Post(':id/revoke')
  revoke(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.kiosks.revoke(requireTenant(auth), id);
  }
}

/**
 * Routes de la borne. Elles n'acceptent que le jeton d'appareil (cookie `ocp_kiosk`) : aucune session
 * d'employé, aucune route d'administration accessible.
 */
@ApiTags('Borne de commande (appareil)')
@Public()
@Controller('kiosk')
class KioskController {
  constructor(
    private readonly kiosks: KioskService,
    private readonly qr: QrOrdersService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Appairage avec le code à usage unique : dépose le jeton d'appareil (cookie httpOnly). */
  @SensitiveRoute()
  @HttpCode(200)
  @Post('pair')
  async pair(@Body() dto: PairKioskDto, @Res({ passthrough: true }) res: Response) {
    const { token, expiresAt, device } = await this.kiosks.pair(dto.code);
    res.cookie(KIOSK_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.cookieSecure,
      path: KIOSK_COOKIE_PATH,
      expires: expiresAt,
    });
    return { deviceName: device.deviceName, establishmentName: device.establishmentName };
  }

  @UseGuards(KioskGuard)
  @Get('me')
  async me(@CurrentKiosk() kiosk: KioskContext) {
    // Imprimante de la borne (type et filtre seulement) : la tablette l'associe une fois au navigateur.
    const device = await this.prisma.kioskDevice.findUnique({
      where: { id: kiosk.deviceId },
      select: {
        printerTerminal: {
          select: { isActive: true, printerConnection: true, printerAddress: true },
        },
      },
    });
    const terminal = device?.printerTerminal;
    return {
      deviceName: kiosk.deviceName,
      establishmentName: kiosk.establishmentName,
      printer:
        terminal?.isActive && terminal.printerConnection !== 'NONE'
          ? { connection: terminal.printerConnection, address: terminal.printerAddress }
          : null,
    };
  }

  @UseGuards(KioskGuard)
  @Get('menu')
  async menu(@CurrentKiosk() kiosk: KioskContext) {
    return {
      establishmentName: kiosk.establishmentName,
      categories: await loadSellableCatalog(
        this.prisma,
        kiosk.organizationId,
        kiosk.establishmentId,
      ),
    };
  }

  @UseGuards(KioskGuard)
  @Post('sessions')
  start(@CurrentKiosk() kiosk: KioskContext) {
    return this.kiosks.startSession(kiosk);
  }

  /** Commande de la session : en attente de paiement à la caisse, jamais envoyée en cuisine. */
  @UseGuards(KioskGuard)
  @Post('sessions/:id/orders')
  async order(
    @CurrentKiosk() kiosk: KioskContext,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: PublicOrderDto,
  ) {
    const order = await this.qr.submitFromKiosk({ ...kiosk, sessionId }, dto);
    // Ticket de commande à imprimer par la borne, si elle a une imprimante (sinon null).
    return { ...order, print: await this.kiosks.ticketFor(kiosk, sessionId) };
  }

  /** La borne rapporte le résultat de l'impression de son ticket (historique d'impression). */
  @UseGuards(KioskGuard)
  @HttpCode(200)
  @Post('print-jobs/:id/result')
  printResult(
    @CurrentKiosk() kiosk: KioskContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KioskPrintResultDto,
  ) {
    return this.kiosks.reportPrint(kiosk, id, dto);
  }

  @UseGuards(KioskGuard)
  @HttpCode(204)
  @Post('sessions/:id/end')
  async end(@CurrentKiosk() kiosk: KioskContext, @Param('id', ParseUUIDPipe) sessionId: string) {
    await this.kiosks.endSession(kiosk, sessionId);
  }
}

@Module({
  imports: [RestaurantModule],
  controllers: [KioskDevicesController, KioskController],
  providers: [KioskService, KioskGuard],
})
export class KioskModule {}
