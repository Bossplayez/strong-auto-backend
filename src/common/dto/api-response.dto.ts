import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiPropertyOptional({
    example: [{ field: 'email', message: 'must be a valid email' }],
  })
  details?: Record<string, unknown> | Array<Record<string, unknown>>;

  @ApiProperty({ example: 'abc-123-def-456' })
  traceId: string;
}
