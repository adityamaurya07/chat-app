import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Uses raw SQL so this works even if Prisma Client types lag after schema changes. */
export async function areFriends(a: string, b: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      SELECT id FROM friendships
      WHERE status = ${"ACCEPTED"}
        AND (
          (requester_id = ${a} AND addressee_id = ${b})
          OR (requester_id = ${b} AND addressee_id = ${a})
        )
      LIMIT 1
    `,
  );
  return rows.length > 0;
}
