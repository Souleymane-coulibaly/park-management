import { Module } from '@nestjs/common';
import { BusinessModulesController } from './business-modules.controller';

@Module({ controllers: [BusinessModulesController] })
export class BusinessModulesModule {}
