-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "loginNameEncrypted" TEXT,
  ADD COLUMN "loginNameLookup" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_loginNameLookup_key" ON "User"("loginNameLookup");
