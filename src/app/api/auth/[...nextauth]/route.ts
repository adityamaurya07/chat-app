import { handlers } from "@/auth";
import { NextRequest } from "next/server";

function deriveUrlFromReq(req: NextRequest) {
  try {
    const host = req.headers.get("host");
    if (!host) return undefined;
    const proto =
      req.headers.get("x-forwarded-proto") ||
      (process.env.NODE_ENV === "production" ? "https" : "http");
    return `${proto}://${host}`;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const url = deriveUrlFromReq(req);
  if (url && !process.env.NEXTAUTH_URL) process.env.NEXTAUTH_URL = url;
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  const url = deriveUrlFromReq(req);
  if (url && !process.env.NEXTAUTH_URL) process.env.NEXTAUTH_URL = url;
  return handlers.POST(req);
}
