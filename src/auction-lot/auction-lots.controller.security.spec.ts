import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuctionLotsController } from './auction-lots.controller';

describe('AuctionLotsController calculator preview access', () => {
  it('requires an authenticated user before a dealer preview can run', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AuctionLotsController.prototype.calculatorPreview,
    );

    expect(guards).toContain(JwtAuthGuard);
  });
});
