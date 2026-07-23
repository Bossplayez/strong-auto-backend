import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CalculatorController } from './calculator.controller';

describe('CalculatorController', () => {
  it('requires an authenticated user before the dealer preview route can run', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      CalculatorController.prototype.preview,
    );

    expect(guards).toContain(JwtAuthGuard);
  });
});
