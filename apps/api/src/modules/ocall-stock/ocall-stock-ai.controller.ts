import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentStock,
  OcallStockAccessGuard,
  RequireStockPermission,
  type StockContext,
} from './ocall-stock-access';
import {
  StockAiAnalysisDto,
  StockAiApplyDto,
  StockAiProposalQueryDto,
  StockAiRestockDto,
  StockAiSettingsDto,
  StockAiStockoutDto,
} from './ocall-stock-ai.dto';
import { OcallStockAiService } from './ocall-stock-ai.service';
import { STOCK_IMAGE_MAX_BYTES, type StockUpload } from './ocall-stock-media.service';

const uuid = new ParseUUIDPipe();
const imageFile = FileInterceptor('file', {
  limits: { fileSize: STOCK_IMAGE_MAX_BYTES + 1, files: 1 },
});

/**
 * Ocall Stock — IA (S8) : réglages et quotas, assistants (réapprovisionnement, ruptures, analyse), IA du
 * catalogue (photo, illustration), propositions et décisions humaines.
 */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock/ai')
export class OcallStockAiController {
  constructor(private readonly ai: OcallStockAiService) {}

  @RequireStockPermission('stock.access')
  @Get('settings')
  settings(@CurrentStock() ctx: StockContext) {
    return this.ai.settings(ctx);
  }

  @RequireStockPermission('stock.settings.manage')
  @Put('settings')
  updateSettings(@CurrentStock() ctx: StockContext, @Body() dto: StockAiSettingsDto) {
    return this.ai.updateSettings(ctx, dto);
  }

  @RequireStockPermission('stock.ai.use')
  @HttpCode(200)
  @Post('restock')
  restock(@CurrentStock() ctx: StockContext, @Body() dto: StockAiRestockDto) {
    return this.ai.restock(ctx, dto);
  }

  @RequireStockPermission('stock.ai.use')
  @HttpCode(200)
  @Post('stockouts')
  stockouts(@CurrentStock() ctx: StockContext, @Body() dto: StockAiStockoutDto) {
    return this.ai.stockouts(ctx, dto);
  }

  @RequireStockPermission('stock.ai.use')
  @HttpCode(200)
  @Post('analysis')
  analysis(@CurrentStock() ctx: StockContext, @Body() dto: StockAiAnalysisDto) {
    return this.ai.analysis(ctx, dto);
  }

  @RequireStockPermission('stock.ai.images')
  @HttpCode(200)
  @Post('product-photo')
  @UseInterceptors(imageFile)
  productPhoto(@CurrentStock() ctx: StockContext, @UploadedFile() file: StockUpload | undefined) {
    return this.ai.productPhoto(ctx, file);
  }

  @RequireStockPermission('stock.ai.images')
  @HttpCode(200)
  @Post('products/:id/illustration')
  illustration(@CurrentStock() ctx: StockContext, @Param('id', uuid) id: string) {
    return this.ai.illustration(ctx, id);
  }

  @RequireStockPermission('stock.ai.use', 'stock.ai.images')
  @Get('proposals')
  proposals(@CurrentStock() ctx: StockContext, @Query() query: StockAiProposalQueryDto) {
    return this.ai.proposals(ctx, query.feature);
  }

  @RequireStockPermission('stock.ai.images')
  @Get('proposals/:id/image')
  async image(
    @CurrentStock() ctx: StockContext,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.ai.proposalImage(ctx, id);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(body);
  }

  @RequireStockPermission('stock.ai.use', 'stock.ai.images')
  @HttpCode(200)
  @Post('proposals/:id/apply')
  apply(
    @CurrentStock() ctx: StockContext,
    @Param('id', uuid) id: string,
    @Body() dto: StockAiApplyDto,
  ) {
    return this.ai.apply(ctx, id, dto);
  }

  @RequireStockPermission('stock.ai.use', 'stock.ai.images')
  @HttpCode(200)
  @Post('proposals/:id/reject')
  reject(@CurrentStock() ctx: StockContext, @Param('id', uuid) id: string) {
    return this.ai.reject(ctx, id);
  }
}
