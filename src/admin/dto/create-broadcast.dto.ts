import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsEnum } from 'class-validator';
import { NotificationChannel } from '../../common/enums';

export class CreateBroadcastDto {
  @ApiProperty({ example: 'Spring Sale Announcement' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Check out our new vehicles with discounts up to 20%\!' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ enum: NotificationChannel, default: NotificationChannel.TELEGRAM })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;
}
