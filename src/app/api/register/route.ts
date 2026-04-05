import { hash } from "bcryptjs";
import { z } from "zod";
import mongoose from "mongoose";
import { connectDb, jsonDbUnavailable, User } from "@/lib/db";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(64),
  email: z.string().trim().email().max(255).toLowerCase(),
  password: z.string().min(10).max(128),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await connectDb();
  } catch (e) {
    console.error("MongoDB connection failed:", e);
    return jsonDbUnavailable(e);
  }

  const existing = await User.findOne({ email: parsed.data.email }).lean();
  if (existing) {
    return Response.json({ error: "This email is already registered" }, { status: 409 });
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const id = new mongoose.Types.ObjectId().toString();
  await User.create({
    _id: id,
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash,
  });

  (globalThis as { __io?: { emit: (e: string) => void } }).__io?.emit("directory:changed");

  return Response.json({ ok: true });
}
