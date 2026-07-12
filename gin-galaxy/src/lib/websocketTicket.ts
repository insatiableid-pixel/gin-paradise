export async function openAuthenticatedWebSocket(sessionId: string): Promise<WebSocket> {
  const response = await fetch("/api/auth/ws-ticket", {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionId}` },
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "Session expired" : "Unable to authorize realtime connection");
  }

  const payload = await response.json() as { ticket?: unknown };
  if (typeof payload.ticket !== "string") {
    throw new Error("Invalid realtime authorization response");
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(
    `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(payload.ticket)}`,
  );
}
