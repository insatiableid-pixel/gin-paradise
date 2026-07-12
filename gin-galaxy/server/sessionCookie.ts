import type { Request, Response } from "express";
import { SESSION_TTL_MS } from "./db.js";

export const SESSION_COOKIE_NAME = "gin_session";

function serializeSessionCookie(value: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.setHeader("Set-Cookie", serializeSessionCookie(sessionId, Math.floor(SESSION_TTL_MS / 1000)));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", serializeSessionCookie("", 0));
}

export function readSessionCookie(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || null;
    } catch {
      return null;
    }
  }

  return null;
}
