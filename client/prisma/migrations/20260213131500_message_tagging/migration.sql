-- AlterTable
ALTER TABLE "Message"
  ADD COLUMN "taggingStatus" "AiJobStatus",
  ADD COLUMN "taggingPayload" JSONB,
  ADD COLUMN "taggingUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "taggingError" TEXT;

-- CreateIndex
CREATE INDEX "Message_taggingStatus_createdAt_idx" ON "Message"("taggingStatus", "createdAt");

-- CreateTable
CREATE TABLE "MessageTagJob" (
    "id" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "imageUrls" JSONB NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTagJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageTagJob_sourceMessageId_key" ON "MessageTagJob"("sourceMessageId");

-- CreateIndex
CREATE INDEX "MessageTagJob_status_runAt_createdAt_idx" ON "MessageTagJob"("status", "runAt", "createdAt");

-- AddForeignKey
ALTER TABLE "MessageTagJob"
ADD CONSTRAINT "MessageTagJob_sourceMessageId_fkey"
FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
