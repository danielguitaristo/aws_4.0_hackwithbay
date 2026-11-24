// Gmail integration (owner: C). Plain fetch against Google's REST APIs, no SDK.
// Scopes: gmail.send (send approved letters) + gmail.readonly (read replies to those threads only).
// Tokens live in an httpOnly cookie — fine for a hackathon demo; a real product would store them
// encrypted server-side.

const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
export const COOKIE = "gmail_tok";

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // ms epoch
}

export const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const redirectUri = (origin: string) => process.env.GOOGLE_REDIRECT_URI ?? `${origin}/api/gmail/callback`;

export function authUrl(origin: string, state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  const t = await res.json();
  return { access_token: t.access_token, refresh_token: t.refresh_token ?? params.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
}

export const exchange = (origin: string, code: string) => tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });

/** Returns valid tokens, refreshing if needed. `changed` tells the route to rewrite the cookie. */
export async function fresh(t: Tokens): Promise<{ tokens: Tokens; changed: boolean }> {
  if (Date.now() < t.expires_at || !t.refresh_token) return { tokens: t, changed: false };
  return { tokens: await tokenRequest({ refresh_token: t.refresh_token, grant_type: "refresh_token" }), changed: true };
}

export async function revoke(t: Tokens) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token ?? t.access_token)}`, { method: "POST" }).catch(() => {});
}

async function gmail<T>(t: Tokens, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`Gmail ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const profile = (t: Tokens) => gmail<{ emailAddress: string }>(t, "profile");

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export async function send(t: Tokens, m: { to: string; subject: string; body: string; threadId?: string }) {
  const raw = [
    `To: ${m.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(m.subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    m.body,
  ].join("\r\n");
  return gmail<{ id: string; threadId: string }>(t, "messages/send", { method: "POST", body: JSON.stringify({ raw: b64url(raw), threadId: m.threadId }) });
}

type Thread = { messages?: { snippet: string; internalDate: string; payload?: { headers?: { name: string; value: string }[] } }[] };

/** Latest message in a thread that was not sent by Claire herself, if any. */
export async function replyIn(t: Tokens, threadId: string, own: string) {
  const th = await gmail<Thread>(t, `threads/${threadId}?format=metadata&metadataHeaders=From`);
  const theirs = (th.messages ?? []).filter((m) => !(m.payload?.headers?.find((h) => h.name === "From")?.value ?? "").toLowerCase().includes(own.toLowerCase()));
  const last = theirs.sort((a, b) => Number(b.internalDate) - Number(a.internalDate))[0];
  return last ? last.snippet.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : null;
}
