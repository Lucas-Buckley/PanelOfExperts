-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "account" (
    "account_id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "panel" (
    "panel_id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" VARCHAR(255),
    "instructions" TEXT,
    "last_prompted_at" TIMESTAMP(3),

    CONSTRAINT "panel_pkey" PRIMARY KEY ("panel_id")
);

-- CreateTable
CREATE TABLE "expert" (
    "expert_id" SERIAL NOT NULL,
    "panel_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "specialization" VARCHAR(255) NOT NULL,
    "soul" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "expert_pkey" PRIMARY KEY ("expert_id")
);

-- CreateTable
CREATE TABLE "conversation" (
    "conversation_id" SERIAL NOT NULL,
    "panel_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "last_prompted_at" TIMESTAMP(3),

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateTable
CREATE TABLE "prompt" (
    "prompt_id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_pkey" PRIMARY KEY ("prompt_id")
);

-- CreateTable
CREATE TABLE "response" (
    "response_id" SERIAL NOT NULL,
    "prompt_id" INTEGER NOT NULL,
    "expert_id" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_pkey" PRIMARY KEY ("response_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_email_key" ON "account"("email");

-- CreateIndex
CREATE INDEX "panel_account_id_idx" ON "panel"("account_id");

-- CreateIndex
CREATE INDEX "panel_last_prompted_at_idx" ON "panel"("last_prompted_at");

-- CreateIndex
CREATE INDEX "expert_panel_id_idx" ON "expert"("panel_id");

-- CreateIndex
CREATE UNIQUE INDEX "expert_panel_id_position_key" ON "expert"("panel_id", "position");

-- CreateIndex
CREATE INDEX "conversation_panel_id_idx" ON "conversation"("panel_id");

-- CreateIndex
CREATE INDEX "conversation_last_prompted_at_idx" ON "conversation"("last_prompted_at");

-- CreateIndex
CREATE INDEX "prompt_conversation_id_idx" ON "prompt"("conversation_id");

-- CreateIndex
CREATE INDEX "prompt_created_at_idx" ON "prompt"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_conversation_id_sequence_key" ON "prompt"("conversation_id", "sequence");

-- CreateIndex
CREATE INDEX "response_prompt_id_idx" ON "response"("prompt_id");

-- CreateIndex
CREATE INDEX "response_expert_id_idx" ON "response"("expert_id");

-- CreateIndex
CREATE INDEX "response_created_at_idx" ON "response"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "response_prompt_id_sequence_key" ON "response"("prompt_id", "sequence");

-- AddForeignKey
ALTER TABLE "panel" ADD CONSTRAINT "panel_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert" ADD CONSTRAINT "expert_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "panel"("panel_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_panel_id_fkey" FOREIGN KEY ("panel_id") REFERENCES "panel"("panel_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response" ADD CONSTRAINT "response_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompt"("prompt_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response" ADD CONSTRAINT "response_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "expert"("expert_id") ON DELETE CASCADE ON UPDATE CASCADE;

