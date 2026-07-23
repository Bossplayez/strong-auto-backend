import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum AuctionAssistanceIntent {
  BID_ASSISTANCE = 'BID_ASSISTANCE',
  BUY_NOW_ASSISTANCE = 'BUY_NOW_ASSISTANCE',
}

/** Contact details are a snapshot for this request; profile data is never updated here. */
export class CreateAuctionAssistanceRequestDto {
  @ApiProperty({ enum: AuctionAssistanceIntent })
  @IsEnum(AuctionAssistanceIntent)
  intent: AuctionAssistanceIntent;

  @ApiProperty({ example: 'Сергій Іваненко' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '+380991234567' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone: string;

  @ApiPropertyOptional({ example: 'Цікавить стан кузова.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
