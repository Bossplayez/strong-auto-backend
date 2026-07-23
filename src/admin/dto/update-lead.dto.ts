import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsString } from 'class-validator';
import { LeadStatus } from '../../common/enums';
import { AssistanceRequestStatus } from '@prisma/client';

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
  assignedToUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalNotes?: string;
}
