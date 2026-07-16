// ─────────────────────────────────────────────────────────────
// Strong Auto — Auction Lots Module (Task 036)
// Public read-only auction lot endpoints.
// Feature-flagged: disabled by default until rollout gates pass.
// ─────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { AuctionImportCompatibilityController, AuctionLotsController } from './auction-lots.controller';
import { AuctionLotsService } from './auction-lots.service';

@Module({
  controllers: [AuctionLotsController, AuctionImportCompatibilityController],
  providers: [AuctionLotsService],
  exports: [AuctionLotsService],
})
export class AuctionLotsModule {}
