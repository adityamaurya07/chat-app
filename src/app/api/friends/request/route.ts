import { auth } from "@/auth";
import { connectDb, Friendship, jsonDbUnavailable, User } from "@/lib/db";
import mongoose from "mongoose";
import { z } from "zod";

const bodySchema = z.object({
  addresseeId: z.string().min(1),
});

function emitDirectoryChanged() {
  const io = (globalThis as { __io?: { emit: (e: string) => void } }).__io;
  io?.emit("directory:changed");
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const me = session.user.id;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const { addresseeId } = parsed.data;
  if (addresseeId === me) {
    return Response.json({ error: "Invalid target" }, { status: 400 });
  }

  try {
    await connectDb();
  } catch (e) {
    console.error("MongoDB connection failed:", e);
    return jsonDbUnavailable(e);
  }

  const target = await User.findById(addresseeId).lean();
  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  type FriendshipLean = {
    _id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
  };

  const reverse = (await Friendship.findOne({
    requesterId: addresseeId,
    addresseeId: me,
  }).lean()) as FriendshipLean | null;

  if (reverse?.status === "PENDING") {
    await Friendship.findByIdAndUpdate(reverse._id, {
      $set: { status: "ACCEPTED", updatedAt: new Date() },
    });
    emitDirectoryChanged();
    return Response.json({ ok: true, status: "accepted" });
  }

  if (reverse?.status === "ACCEPTED") {
    return Response.json({ error: "Already friends" }, { status: 409 });
  }

  const forward = (await Friendship.findOne({
    requesterId: me,
    addresseeId,
  }).lean()) as FriendshipLean | null;

  if (forward?.status === "ACCEPTED") {
    return Response.json({ error: "Already friends" }, { status: 409 });
  }
  if (forward?.status === "PENDING") {
    return Response.json({ error: "Request already sent" }, { status: 409 });
  }

  if (forward?.status === "DECLINED") {
    await Friendship.findByIdAndUpdate(forward._id, {
      $set: { status: "PENDING", updatedAt: new Date() },
    });
    emitDirectoryChanged();
    return Response.json({ ok: true, status: "requested" });
  }

  const id = new mongoose.Types.ObjectId().toString();
  await Friendship.create({
    _id: id,
    requesterId: me,
    addresseeId,
    status: "PENDING",
  });
  emitDirectoryChanged();
  return Response.json({ ok: true, status: "requested" });
}
