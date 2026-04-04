import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const isAuthed = !!req.auth;

  if (path.startsWith("/chat") && !isAuthed) {
    const login = new URL("/login", req.nextUrl.origin);
    login.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(login);
  }

  if (isAuthed && (path === "/login" || path === "/register")) {
    return NextResponse.redirect(new URL("/chat", req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/chat", "/chat/:path*", "/login", "/register"],
};
