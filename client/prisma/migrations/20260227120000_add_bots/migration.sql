CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mentionHandle" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "catchphrases" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Bot_mentionHandle_key" ON "Bot"("mentionHandle");
CREATE INDEX "Bot_ownerUserId_createdAt_idx" ON "Bot"("ownerUserId", "createdAt");
CREATE INDEX "Bot_deletedAt_displayName_idx" ON "Bot"("deletedAt", "displayName");

ALTER TABLE "Message" ADD COLUMN "botId" TEXT;
CREATE INDEX "Message_botId_idx" ON "Message"("botId");

ALTER TABLE "AiJob" ADD COLUMN "targetKey" TEXT;
ALTER TABLE "AiJob" ADD COLUMN "provider" TEXT;
ALTER TABLE "AiJob" ADD COLUMN "botId" TEXT;

UPDATE "AiJob"
SET "targetKey" = 'legacy'
WHERE "targetKey" IS NULL;

ALTER TABLE "AiJob" ALTER COLUMN "targetKey" SET NOT NULL;

DROP INDEX "AiJob_sourceMessageId_key";
CREATE UNIQUE INDEX "AiJob_sourceMessageId_targetKey_key" ON "AiJob"("sourceMessageId", "targetKey");
CREATE INDEX "AiJob_botId_status_runAt_idx" ON "AiJob"("botId", "status", "runAt");

ALTER TABLE "Bot"
ADD CONSTRAINT "Bot_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message"
ADD CONSTRAINT "Message_botId_fkey"
FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiJob"
ADD CONSTRAINT "AiJob_botId_fkey"
FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
