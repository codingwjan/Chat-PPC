ALTER TABLE "Bot"
ADD COLUMN "autonomousEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autonomousMinIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "autonomousMaxIntervalMinutes" INTEGER NOT NULL DEFAULT 240,
ADD COLUMN "autonomousPrompt" TEXT,
ADD COLUMN "autonomousNextAt" TIMESTAMP(3);

CREATE INDEX "Bot_autonomousEnabled_autonomousNextAt_idx"
ON "Bot"("autonomousEnabled", "autonomousNextAt");
