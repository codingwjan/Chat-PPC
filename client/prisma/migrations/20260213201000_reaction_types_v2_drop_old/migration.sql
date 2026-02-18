-- We intentionally reset old reaction data before enum migration.
DELETE FROM "MessageReaction";
DELETE FROM "Notification";

ALTER TYPE "MessageReactionType" RENAME TO "MessageReactionType_old";

CREATE TYPE "MessageReactionType" AS ENUM ('LOL', 'FIRE', 'BASED', 'WTF', 'BIG_BRAIN');

ALTER TABLE "MessageReaction"
ALTER COLUMN "reaction" TYPE "MessageReactionType"
USING ("reaction"::text::"MessageReactionType");

ALTER TABLE "Notification"
ALTER COLUMN "reaction" TYPE "MessageReactionType"
USING ("reaction"::text::"MessageReactionType");

DROP TYPE "MessageReactionType_old";
