import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // No public endpoints - audit logs are accessed via AdminController GET /admin/audit-logs.
  // The AuditService.log() method is called internally by other services.
}
