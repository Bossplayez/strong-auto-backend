import { ApiProperty } from '@nestjs/swagger';

export class UploadResponseDto {
  @ApiProperty({ example: 'file_abc123' })
  id: string;

  @ApiProperty({ example: 'https://cdn.strongauto.com/images/abc123.jpg' })
  url: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ example: 204800 })
  size: number;
}
