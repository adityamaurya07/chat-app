import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const bodySchema = z.object({
  requesterId: z.string().min(1),
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

  const { requesterId } = parsed.data;

  const updated = await prisma.friendship.updateMany({
    where: {
      requesterId,
      addresseeId: me,
      status: "PENDING",
    },
    data: { status: "DECLINED" },
  });

  if (updated.count === 0) {
    return Response.json({ error: "No pending request" }, { status: 404 });
  }

  emitDirectoryChanged();
  return Response.json({ ok: true });
}
