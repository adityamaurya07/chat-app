import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { areFriends } from "@/lib/are-friends";
import { dmRoomId } from "@/lib/dm";
import { prisma } from "@/lib/prisma";

type MessageListRow = Prisma.MessageGetPayload<{
  select: {
    id: true;
    userId: true;
    userName: true;
    content: true;
    createdAt: true;
  };
}>;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const peerId = new URL(req.url).searchParams.get("peerId");
  if (!peerId) {
    return Response.json({ error: "peerId required" }, { status: 400 });
  }

  const me = session.user.id;
  if (peerId === me) {
    return Response.json({ error: "Invalid peer" }, { status: 400 });
  }

  if (!(await areFriends(me, peerId))) {
    return Response.json({ error: "Not friends" }, { status: 403 });
  }

  const roomId = dmRoomId(me, peerId);

  const messages = await prisma.message.findMany({
    where: { roomId },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      userId: true,
      userName: true,
      content: true,
      createdAt: true,
    },
  });

  return Response.json(
    messages.map((m: MessageListRow) => ({
      ...m,
      createdAt: m.createdAt.getTime(),
    })),
  );
}
