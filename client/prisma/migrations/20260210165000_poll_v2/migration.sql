-- Alter existing message table with richer poll settings.
ALTER TABLE "Message"
ADD COLUMN "pollMultiSelect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "pollAllowVoteChange" BOOLEAN NOT NULL DEFAULT false;

-- Poll options for up to 15 answer choices.
CREATE TABLE "PollOption" (
  "id" TEXT NOT NULL,
  "pollMessageId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PollChoiceVote" (
  "id" TEXT NOT NULL,
  "pollMessageId" TEXT NOT NULL,
  "pollOptionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PollChoiceVote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PollOption_pollMessageId_idx" ON "PollOption"("pollMessageId");
CREATE UNIQUE INDEX "PollOption_pollMessageId_sortOrder_key" ON "PollOption"("pollMessageId", "sortOrder");

CREATE INDEX "PollChoiceVote_pollMessageId_idx" ON "PollChoiceVote"("pollMessageId");
CREATE INDEX "PollChoiceVote_pollOptionId_idx" ON "PollChoiceVote"("pollOptionId");
CREATE INDEX "PollChoiceVote_userId_idx" ON "PollChoiceVote"("userId");
CREATE UNIQUE INDEX "PollChoiceVote_pollMessageId_userId_pollOptionId_key"
ON "PollChoiceVote"("pollMessageId", "userId", "pollOptionId");

ALTER TABLE "PollOption"
ADD CONSTRAINT "PollOption_pollMessageId_fkey"
FOREIGN KEY ("pollMessageId") REFERENCES "Message"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PollChoiceVote"
ADD CONSTRAINT "PollChoiceVote_pollMessageId_fkey"
FOREIGN KEY ("pollMessageId") REFERENCES "Message"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PollChoiceVote"
ADD CONSTRAINT "PollChoiceVote_pollOptionId_fkey"
FOREIGN KEY ("pollOptionId") REFERENCES "PollOption"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PollChoiceVote"
ADD CONSTRAINT "PollChoiceVote_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
