import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type AuthContext, requireTenant } from '../../common/auth-context';
import { CurrentAuth, RequireActivity, RequirePermission } from '../../common/decorators';
import {
  CreateCategoryDto,
  CreateProductDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

@ApiTags('Catalogue')
@RequireActivity('RESTAURANT')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @RequirePermission('catalog.read')
  @Get('categories')
  listCategories(@CurrentAuth() auth: AuthContext) {
    return this.catalog.listCategories(requireTenant(auth));
  }

  @RequirePermission('catalog.manage')
  @Post('categories')
  createCategory(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(requireTenant(auth), dto);
  }

  @RequirePermission('catalog.manage')
  @Patch('categories/:id')
  updateCategory(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(requireTenant(auth), id, dto);
  }

  @RequirePermission('catalog.read')
  @Get('products')
  listProducts(@CurrentAuth() auth: AuthContext) {
    return this.catalog.listProducts(requireTenant(auth));
  }

  @RequirePermission('catalog.read')
  @Get('products/:id')
  getProduct(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getProduct(requireTenant(auth), id);
  }

  @RequirePermission('catalog.manage')
  @Post('products')
  createProduct(@CurrentAuth() auth: AuthContext, @Body() dto: CreateProductDto) {
    return this.catalog.createProduct(requireTenant(auth), dto);
  }

  @RequirePermission('catalog.manage')
  @Patch('products/:id')
  updateProduct(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(requireTenant(auth), id, dto);
  }
}
