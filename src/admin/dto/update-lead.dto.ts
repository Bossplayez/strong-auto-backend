import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsString } from 'class-validator';
import { AssistanceRequestStatus, LeadStatus } from '@prisma/client';

export class UpdateLeadDto {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ enum: AssistanceRequestStatus })
  @IsOptional()
  @IsEnum(AssistanceRequestStatus)
  assistanceStatus?: AssistanceRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToUserId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;

  /** Backwards-compatible admin-client field name. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalNotes?: string;
}
