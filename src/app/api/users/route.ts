import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type FriendshipRow = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: string;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const me = session.user.id;

  const others = await prisma.user.findMany({
    where: { id: { not: me } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });

  type SqlFriendship = {
    id: string;
    requester_id: string;
    addressee_id: string;
    status: string;
  };

  const raw = await prisma.$queryRaw<SqlFriendship[]>(
    Prisma.sql`SELECT id, requester_id, addressee_id, status FROM friendships WHERE requester_id = ${me} OR addressee_id = ${me}`,
  );

  const links: FriendshipRow[] = raw.map((r: SqlFriendship) => ({
    id: r.id,
    requesterId: r.requester_id,
    addresseeId: r.addressee_id,
    status: r.status,
  }));

  type OtherUser = { id: string; name: string; email: string };

  const users = others.map((u: OtherUser) => {
    const f = links.find(
      (l) =>
        (l.requesterId === me && l.addresseeId === u.id) ||
        (l.requesterId === u.id && l.addresseeId === me),
    );
    if (!f) {
      return { id: u.id, name: u.name, email: u.email, relation: "none" as const };
    }
    if (f.status === "ACCEPTED") {
      return { id: u.id, name: u.name, email: u.email, relation: "friends" as const };
    }
    if (f.status === "PENDING") {
      if (f.requesterId === me) {
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          relation: "outgoing" as const,
          friendshipId: f.id,
        };
      }
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        relation: "incoming" as const,
        friendshipId: f.id,
      };
    }
    return { id: u.id, name: u.name, email: u.email, relation: "none" as const };
  });

  return Response.json(users);
}
