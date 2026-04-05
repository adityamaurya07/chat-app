import { auth } from "@/auth";
import { areFriends } from "@/lib/are-friends";
import { dmRoomId } from "@/lib/dm";
import { connectDb, jsonDbUnavailable, Message } from "@/lib/db";

type MessageListRow = {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: Date;
};

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

  try {
    await connectDb();
  } catch (e) {
    console.error("MongoDB connection failed:", e);
    return jsonDbUnavailable(e);
  }

  if (!(await areFriends(me, peerId))) {
    return Response.json({ error: "Not friends" }, { status: 403 });
  }

  const roomId = dmRoomId(me, peerId);

  const docs = await Message.find({ roomId })
    .sort({ createdAt: 1 })
    .limit(200)
    .select({ userId: 1, userName: 1, content: 1, createdAt: 1 })
    .lean();

  const messages: MessageListRow[] = docs.map((m) => ({
    id: String(m._id),
    userId: m.userId,
    userName: m.userName,
    content: m.content,
    createdAt: m.createdAt,
  }));

  return Response.json(
    messages.map((m) => ({
      ...m,
      createdAt: m.createdAt.getTime(),
    })),
  );
}
