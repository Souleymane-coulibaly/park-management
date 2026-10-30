import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { SaasService } from './saas.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [PlatformController],
  providers: [PlatformService, SaasService],
})
export class PlatformModule {}
