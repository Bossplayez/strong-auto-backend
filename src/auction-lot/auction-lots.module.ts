// ─────────────────────────────────────────────────────────────
// Strong Auto — Auction Lots Module (Task 036)
// Public read-only auction lot endpoints.
// Feature-flagged: disabled by default until rollout gates pass.
// ─────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { AuctionImportCompatibilityController, AuctionLotsController, AuctionLotFavoritesController } from './auction-lots.controller';
import { AuctionLotsService } from './auction-lots.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuctionLotsController, AuctionImportCompatibilityController, AuctionLotFavoritesController],
  providers: [AuctionLotsService],
  exports: [AuctionLotsService],
})
export class AuctionLotsModule {}
