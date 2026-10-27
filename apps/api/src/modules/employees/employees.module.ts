import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
})
export class EmployeesModule {}
