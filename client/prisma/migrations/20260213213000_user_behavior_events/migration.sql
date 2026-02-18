-- CreateEnum
CREATE TYPE "UserBehaviorEventType" AS ENUM (
  'MESSAGE_CREATED',
  'MESSAGE_TAGGING_COMPLETED',
  'MESSAGE_TAGGING_FAILED',
  'REACTION_GIVEN',
  'REACTION_RECEIVED',
  'POLL_CREATED',
  'POLL_EXTENDED',
  'POLL_VOTE_GIVEN',
  'AI_MENTION_SENT'
);

-- CreateTable
CREATE TABLE "UserBehaviorEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "UserBehaviorEventType" NOT NULL,
  "messageId" TEXT,
  "relatedUserId" TEXT,
  "reaction" "MessageReactionType",
  "preview" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserBehaviorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserBehaviorEvent_userId_createdAt_idx" ON "UserBehaviorEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserBehaviorEvent_userId_type_createdAt_idx" ON "UserBehaviorEvent"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "UserBehaviorEvent_expiresAt_idx" ON "UserBehaviorEvent"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserBehaviorEvent"
ADD CONSTRAINT "UserBehaviorEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBehaviorEvent"
ADD CONSTRAINT "UserBehaviorEvent_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
