// ─────────────────────────────────────────────────────────────
// Strong Auto — Auction Lots Module (Task 036)
// Public read-only auction lot endpoints.
// Feature-flagged: disabled by default until rollout gates pass.
// ─────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { AuctionLotsController } from './auction-lots.controller';
import { AuctionLotsService } from './auction-lots.service';

const AUCTION_LOTS_ENABLED =
  process.env.AUCTION_LOTS_ENABLED === 'true' ||
  process.env.NODE_ENV === 'development';

@Module({
  controllers: AUCTION_LOTS_ENABLED ? [AuctionLotsController] : [],
  providers: [AuctionLotsService],
  exports: [AuctionLotsService],
})
export class AuctionLotsModule {}
