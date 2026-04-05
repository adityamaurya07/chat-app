import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { connectDb } from "@/lib/db";

export default async function Home() {
  const session = await auth();
  await connectDb();
  redirect(session ? "/chat" : "/login");
}
