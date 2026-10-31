import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePlatformPermission, SuperAdminOnly } from '../../common/decorators';
import { StorageService } from '../../common/storage/storage.service';
import { OperationsService } from './operations.service';
import { CommercialQueryDto, SetQuotasDto } from './platform.dto';

/** Exploitation Ocall Suite (Sprint 11B) : consommation IA, stockage, quotas, paramètres. */
@ApiTags('Plateforme Ocall Suite')
@SuperAdminOnly()
@Controller('platform')
export class OperationsController {
  constructor(
    private readonly operations: OperationsService,
    private readonly storage: StorageService,
  ) {}

  @RequirePlatformPermission('platform.dashboard')
  @Get('ai-usage')
  aiUsage(@Query() q: CommercialQueryDto) {
    return this.operations.aiUsage({ productCode: q.product, from: q.from, to: q.to });
  }

  @RequirePlatformPermission('platform.dashboard')
  @Get('storage')
  storageUsage(@Query() q: CommercialQueryDto) {
    return this.operations.storageUsage(q.product);
  }

  /** Purge immédiate des fichiers privés arrivés en fin de conservation. */
  @RequirePlatformPermission('platform.quotas.manage')
  @HttpCode(200)
  @Post('storage/purge')
  purge(@CurrentAuth() auth: AuthContext) {
    return this.storage.purgeExpired(auth.user.id);
  }

  @RequirePlatformPermission('platform.quotas.manage')
  @Patch('organizations/:id/quotas')
  setQuotas(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetQuotasDto,
  ) {
    return this.operations.setQuotas(auth, id, dto);
  }

  @RequirePlatformPermission('platform.settings.read')
  @Get('settings')
  settings() {
    return this.operations.settings();
  }
}
