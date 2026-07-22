import { Module } from '@nestjs/common';
import { CalculatorController } from './calculator.controller';
import { CalculatorService } from './calculator.service';
import { CalculatorEngineService } from './calculator-engine.service';

@Module({
  controllers: [CalculatorController],
  providers: [CalculatorService, CalculatorEngineService],
  exports: [CalculatorService],
})
export class CalculatorModule {}
