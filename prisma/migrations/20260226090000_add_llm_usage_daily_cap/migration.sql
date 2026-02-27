-- AlterTable
ALTER TABLE "prompt"
ADD COLUMN "llm_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "llm_output_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "llm_total_tokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "llm_usage_daily" (
    "usage_date" DATE NOT NULL,
    "model" VARCHAR(255) NOT NULL,
    "used_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_usage_daily_pkey" PRIMARY KEY ("usage_date","model")
);
