ALTER TABLE "Bot" ADD COLUMN "profilePicture" TEXT;

UPDATE "Bot"
SET "profilePicture" = '/default-avatar.svg'
WHERE "profilePicture" IS NULL;

ALTER TABLE "Bot" ALTER COLUMN "profilePicture" SET NOT NULL;
