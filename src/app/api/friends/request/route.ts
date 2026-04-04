import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

  const target = await prisma.user.findUnique({ where: { id: addresseeId } });
  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const reverse = await prisma.friendship.findUnique({
    where: {
      requesterId_addresseeId: { requesterId: addresseeId, addresseeId: me },
    },
  });

  if (reverse?.status === "PENDING") {
    await prisma.friendship.update({
      where: { id: reverse.id },
      data: { status: "ACCEPTED" },
    });
    emitDirectoryChanged();
    return Response.json({ ok: true, status: "accepted" });
  }

  if (reverse?.status === "ACCEPTED") {
    return Response.json({ error: "Already friends" }, { status: 409 });
  }

  const forward = await prisma.friendship.findUnique({
    where: {
      requesterId_addresseeId: { requesterId: me, addresseeId },
    },
  });

  if (forward?.status === "ACCEPTED") {
    return Response.json({ error: "Already friends" }, { status: 409 });
  }
  if (forward?.status === "PENDING") {
    return Response.json({ error: "Request already sent" }, { status: 409 });
  }

  if (forward?.status === "DECLINED") {
    await prisma.friendship.update({
      where: { id: forward.id },
      data: { status: "PENDING" },
    });
    emitDirectoryChanged();
    return Response.json({ ok: true, status: "requested" });
  }

  await prisma.friendship.create({
    data: {
      requesterId: me,
      addresseeId,
      status: "PENDING",
    },
  });
  emitDirectoryChanged();
  return Response.json({ ok: true, status: "requested" });
}
