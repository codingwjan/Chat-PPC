import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { recomputePpcMemberForUser } from "../src/server/chat-service";

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, clientId: true },
    orderBy: [{ createdAt: "asc" }],
  });

  let processed = 0;
  for (const user of users) {
    await recomputePpcMemberForUser(user.id, { emitRankUp: false });
    processed += 1;
    if (processed % 50 === 0) {
      console.log(`Backfill progress: ${processed}/${users.length}`);
    }
  }

  console.log(`PPC Member backfill complete: ${processed} users processed.`);
}

main()
  .catch((error) => {
    console.error("PPC Member backfill failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
