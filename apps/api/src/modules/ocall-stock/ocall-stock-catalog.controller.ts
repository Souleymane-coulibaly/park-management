import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { download } from '../../common/download';
import {
  CurrentStock,
  OcallStockAccessGuard,
  RequireStockPermission,
  type StockContext,
} from './ocall-stock-access';
import { OcallStockCatalogService } from './ocall-stock-catalog.service';
import { OcallStockLabelsService } from './ocall-stock-labels.service';
import {
  OcallStockMediaService,
  STOCK_IMAGE_MAX_BYTES,
  type StockUpload,
} from './ocall-stock-media.service';
import { OcallStockSearchService } from './ocall-stock-search.service';
import { OcallStockSuppliersService } from './ocall-stock-suppliers.service';
import {
  StockBarcodeDto,
  StockBrandDto,
  StockCategoryDto,
  StockLabelsDto,
  StockListQueryDto,
  StockLookupQueryDto,
  StockProductDto,
  StockProductQueryDto,
  StockGlobalSearchQueryDto,
  StockSupplierDto,
  StockVariantDto,
  UpdateStockBrandDto,
  UpdateStockCategoryDto,
  UpdateStockProductDto,
  UpdateStockSupplierDto,
  UpdateStockVariantDto,
} from './ocall-stock.dto';

const imageFile = FileInterceptor('file', {
  // Marge au-delà de la limite métier : le service renvoie un refus explicite plutôt qu'une erreur 413.
  limits: { fileSize: STOCK_IMAGE_MAX_BYTES + 1, files: 1 },
});

/** Ocall Stock — catalogue, codes-barres, photos, fournisseurs, recherche et étiquettes (S1). */
@ApiTags('Ocall Stock')
@UseGuards(OcallStockAccessGuard)
@Controller('ocall-stock')
export class OcallStockCatalogController {
  constructor(
    private readonly catalog: OcallStockCatalogService,
    private readonly media: OcallStockMediaService,
    private readonly suppliers: OcallStockSuppliersService,
    private readonly searchService: OcallStockSearchService,
    private readonly labels: OcallStockLabelsService,
  ) {}

  // ─── Catégories et marques ───

  @RequireStockPermission('stock.catalog.read')
  @Get('categories')
  categories(@CurrentStock() ctx: StockContext, @Query() q: StockListQueryDto) {
    return this.catalog.listCategories(ctx, q);
  }

  @RequireStockPermission('stock.catalog.manage')
  @Post('categories')
  createCategory(@CurrentStock() ctx: StockContext, @Body() dto: StockCategoryDto) {
    return this.catalog.createCategory(ctx, dto);
  }

  @RequireStockPermission('stock.catalog.manage')
  @Patch('categories/:id')
  updateCategory(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockCategoryDto,
  ) {
    return this.catalog.updateCategory(ctx, id, dto);
  }

  @RequireStockPermission('stock.catalog.read')
  @Get('brands')
  brands(@CurrentStock() ctx: StockContext, @Query() q: StockListQueryDto) {
    return this.catalog.listBrands(ctx, q);
  }

  @RequireStockPermission('stock.catalog.manage')
  @Post('brands')
  createBrand(@CurrentStock() ctx: StockContext, @Body() dto: StockBrandDto) {
    return this.catalog.createBrand(ctx, dto);
  }

  @RequireStockPermission('stock.catalog.manage')
  @Patch('brands/:id')
  updateBrand(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockBrandDto,
  ) {
    return this.catalog.updateBrand(ctx, id, dto);
  }

  // ─── Articles ───

  @RequireStockPermission('stock.catalog.read')
  @Get('products')
  products(@CurrentStock() ctx: StockContext, @Query() q: StockProductQueryDto) {
    return this.catalog.listProducts(ctx, q);
  }

  @RequireStockPermission('stock.catalog.manage')
  @Post('products')
  createProduct(@CurrentStock() ctx: StockContext, @Body() dto: StockProductDto) {
    return this.catalog.createProduct(ctx, dto);
  }

  @RequireStockPermission('stock.catalog.read')
  @Get('products/:id')
  product(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.product(ctx, id);
  }

  /** Modification : catalogue ; un changement de prix exige en plus le droit de modifier les prix. */
  @RequireStockPermission('stock.catalog.manage', 'stock.prices.manage')
  @Patch('products/:id')
  updateProduct(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockProductDto,
  ) {
    return this.catalog.updateProductChecked(ctx, id, dto);
  }

  @RequireStockPermission('stock.catalog.read')
  @Get('products/:id/history')
  history(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.history(ctx, id);
  }

  // ─── Variantes et codes-barres ───

  @RequireStockPermission('stock.catalog.manage')
  @Post('products/:id/variants')
  createVariant(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockVariantDto,
  ) {
    return this.catalog.createVariant(ctx, id, dto);
  }

  @RequireStockPermission('stock.catalog.manage', 'stock.prices.manage')
  @Patch('variants/:id')
  updateVariant(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockVariantDto,
  ) {
    return this.catalog.updateVariantChecked(ctx, id, dto);
  }

  @RequireStockPermission('stock.catalog.manage')
  @Post('variants/:id/barcodes')
  addBarcode(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockBarcodeDto,
  ) {
    return this.catalog.addBarcode(ctx, id, dto);
  }

  @RequireStockPermission('stock.catalog.manage')
  @Post('variants/:id/internal-code')
  internalCode(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.generateInternalCode(ctx, id);
  }

  @RequireStockPermission('stock.catalog.manage')
  @HttpCode(204)
  @Delete('barcodes/:id')
  async removeBarcode(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.removeBarcode(ctx, id);
  }

  @RequireStockPermission('stock.catalog.read')
  @Get('lookup')
  lookup(@CurrentStock() ctx: StockContext, @Query() q: StockLookupQueryDto) {
    return this.catalog.lookup(ctx, q.code);
  }

  // ─── Photos ───

  @RequireStockPermission('stock.catalog.manage')
  @UseInterceptors(imageFile)
  @Post('products/:id/images')
  addImage(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: StockUpload | undefined,
  ) {
    return this.media.add(ctx, id, file);
  }

  @RequireStockPermission('stock.catalog.read')
  @Get('products/:id/images/:imageId')
  async image(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const body = await this.media.body(ctx, id, imageId);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(body);
  }

  @RequireStockPermission('stock.catalog.manage')
  @HttpCode(204)
  @Delete('products/:id/images/:imageId')
  async removeImage(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    await this.media.remove(ctx, id, imageId);
  }

  // ─── Fournisseurs ───

  @RequireStockPermission('stock.suppliers.read')
  @Get('suppliers')
  listSuppliers(@CurrentStock() ctx: StockContext, @Query() q: StockListQueryDto) {
    return this.suppliers.list(ctx, q);
  }

  @RequireStockPermission('stock.suppliers.read')
  @Get('suppliers/:id')
  supplier(@CurrentStock() ctx: StockContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.get(ctx, id);
  }

  @RequireStockPermission('stock.suppliers.manage')
  @Post('suppliers')
  createSupplier(@CurrentStock() ctx: StockContext, @Body() dto: StockSupplierDto) {
    return this.suppliers.create(ctx, dto);
  }

  @RequireStockPermission('stock.suppliers.manage')
  @Patch('suppliers/:id')
  updateSupplier(
    @CurrentStock() ctx: StockContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockSupplierDto,
  ) {
    return this.suppliers.update(ctx, id, dto);
  }

  // ─── Recherche et étiquettes ───

  @RequireStockPermission('stock.catalog.read')
  @Get('search')
  search(@CurrentStock() ctx: StockContext, @Query() q: StockGlobalSearchQueryDto) {
    return this.searchService.search(ctx, q.q, { type: q.type, page: q.page, limit: q.limit });
  }

  @RequireStockPermission('stock.labels.print')
  @HttpCode(200)
  @Post('labels.pdf')
  async printLabels(
    @CurrentStock() ctx: StockContext,
    @Body() dto: StockLabelsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return download(res, await this.labels.render(ctx, dto), 'application/pdf', 'etiquettes.pdf');
  }
}
