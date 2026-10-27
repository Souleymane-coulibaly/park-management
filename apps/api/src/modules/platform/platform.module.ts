import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
