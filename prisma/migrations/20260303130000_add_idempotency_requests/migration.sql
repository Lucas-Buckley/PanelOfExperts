-- CreateTable
CREATE TABLE "idempotency_request" (
    "idempotency_request_id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "endpoint" VARCHAR(128) NOT NULL,
    "method" VARCHAR(8) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_request_pkey" PRIMARY KEY ("idempotency_request_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_request_account_id_endpoint_method_idempotency_key_key" ON "idempotency_request"("account_id", "endpoint", "method", "idempotency_key");

-- CreateIndex
CREATE INDEX "idempotency_request_expires_at_idx" ON "idempotency_request"("expires_at");

-- CreateIndex
CREATE INDEX "idempotency_request_account_id_created_at_idx" ON "idempotency_request"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "idempotency_request" ADD CONSTRAINT "idempotency_request_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;
