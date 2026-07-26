import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AiLotReviewDecisionState, AiLotVerdict } from '@prisma/client';

export class AiVisibleRiskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  imageIndexes!: number[];
}

export class SubmitAiLotAnalysisDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  lotId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  modelIdentifier!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  policyVersion!: string;

  @IsEnum(AiLotVerdict)
  verdict!: AiLotVerdict;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1)
  confidence!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(500, { each: true })
  reasons!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => AiVisibleRiskDto)
  visibleRisks!: AiVisibleRiskDto[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  referencedImageIndexes!: number[];
}

export class AiReviewDecisionDto {
  @IsEnum(AiLotReviewDecisionState)
  decision!: AiLotReviewDecisionState;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
