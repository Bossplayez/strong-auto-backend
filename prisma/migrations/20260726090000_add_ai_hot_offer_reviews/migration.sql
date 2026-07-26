CREATE TYPE "AiLotVerdict" AS ENUM ('RECOMMEND', 'CAUTION', 'REJECT');
CREATE TYPE "AiLotReviewDecisionState" AS ENUM ('CONFIRMED', 'REJECTED', 'NEEDS_REVIEW');

CREATE TABLE "ai_lot_analyses" (
  "id" TEXT NOT NULL,
  "discovered_lot_id" TEXT NOT NULL,
  "model_identifier" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "verdict" "AiLotVerdict" NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "reasons_json" JSONB NOT NULL,
  "visible_risks_json" JSONB NOT NULL,
  "image_indexes_json" JSONB NOT NULL,
  "provider_facts_json" JSONB NOT NULL,
  "source_payload_hash" TEXT,
  "source_facts_digest" TEXT NOT NULL,
  "media_count" INTEGER NOT NULL,
  "payload_digest" TEXT NOT NULL,
  "contract_version" TEXT NOT NULL DEFAULT 'ai-hot-offer-review-v1',
  "current_decision_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_lot_analyses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_lot_analyses_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE TABLE "ai_lot_review_decisions" (
  "id" TEXT NOT NULL,
  "analysis_id" TEXT NOT NULL,
  "discovered_lot_id" TEXT NOT NULL,
  "decision" "AiLotReviewDecisionState" NOT NULL,
  "note" TEXT,
  "decided_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_lot_review_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_lot_analyses_discovered_lot_id_model_identifier_policy_version_source_facts_digest_key"
  ON "ai_lot_analyses"("discovered_lot_id", "model_identifier", "policy_version", "source_facts_digest");
CREATE UNIQUE INDEX "ai_lot_analyses_current_decision_id_key"
  ON "ai_lot_analyses"("current_decision_id");
CREATE INDEX "ai_lot_analyses_discovered_lot_id_created_at_idx"
  ON "ai_lot_analyses"("discovered_lot_id", "created_at");
CREATE INDEX "ai_lot_review_decisions_analysis_id_created_at_idx"
  ON "ai_lot_review_decisions"("analysis_id", "created_at");
CREATE INDEX "ai_lot_review_decisions_discovered_lot_id_created_at_idx"
  ON "ai_lot_review_decisions"("discovered_lot_id", "created_at");

ALTER TABLE "ai_lot_analyses"
  ADD CONSTRAINT "ai_lot_analyses_discovered_lot_id_fkey"
  FOREIGN KEY ("discovered_lot_id") REFERENCES "discovered_lots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_lot_review_decisions"
  ADD CONSTRAINT "ai_lot_review_decisions_analysis_id_fkey"
  FOREIGN KEY ("analysis_id") REFERENCES "ai_lot_analyses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_lot_analyses"
  ADD CONSTRAINT "ai_lot_analyses_current_decision_id_fkey"
  FOREIGN KEY ("current_decision_id") REFERENCES "ai_lot_review_decisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_lot_review_decisions"
  ADD CONSTRAINT "ai_lot_review_decisions_discovered_lot_id_fkey"
  FOREIGN KEY ("discovered_lot_id") REFERENCES "discovered_lots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_lot_review_decisions"
  ADD CONSTRAINT "ai_lot_review_decisions_decided_by_user_id_fkey"
  FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
