import { connectDb, Friendship } from "@/lib/db";

export async function areFriends(a: string, b: string): Promise<boolean> {
  await connectDb();
  const one = await Friendship.findOne({
    status: "ACCEPTED",
    $or: [
      { requesterId: a, addresseeId: b },
      { requesterId: b, addresseeId: a },
    ],
  })
    .select("_id")
    .lean();
  return one != null;
}
