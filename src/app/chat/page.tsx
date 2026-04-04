import { auth } from "@/auth";
import { ChatRoom } from "@/components/chat-room";
import { redirect } from "next/navigation";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <ChatRoom userId={session.user.id} userName={session.user.name ?? session.user.email ?? "User"} />
  );
}
