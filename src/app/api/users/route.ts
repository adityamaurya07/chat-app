import { auth } from "@/auth";
import { connectDb, Friendship, jsonDbUnavailable, User } from "@/lib/db";

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

  try {
    await connectDb();
  } catch (e) {
    console.error("MongoDB connection failed:", e);
    return jsonDbUnavailable(e);
  }

  const otherDocs = await User.find({ _id: { $ne: me } })
    .select({ name: 1, email: 1 })
    .sort({ name: 1 })
    .lean();

  const others = otherDocs.map((u) => ({
    id: String(u._id),
    name: u.name as string,
    email: u.email as string,
  }));

  const friendshipDocs = await Friendship.find({
    $or: [{ requesterId: me }, { addresseeId: me }],
  }).lean();

  const links: FriendshipRow[] = friendshipDocs.map((d) => ({
    id: String(d._id),
    requesterId: d.requesterId,
    addresseeId: d.addresseeId,
    status: d.status,
  }));

  const users = others.map((u) => {
    const f = links.find(
      (l) =>
        (l.requesterId === me && l.addresseeId === u.id) ||
        (l.requesterId === u.id && l.addresseeId === me),
    );
    if (!f) {
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        relation: "none" as const,
      };
    }
    if (f.status === "ACCEPTED") {
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        relation: "friends" as const,
      };
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
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      relation: "none" as const,
    };
  });

  return Response.json(users);
}
