// Gmail routes (owner: C):
//   GET  /api/gmail/status      -> { configured, connected, email }
//   GET  /api/gmail/auth        -> redirect to Google consent (?returnTo=/path)
//   GET  /api/gmail/callback    -> store tokens, back to returnTo?gmail=connected
//   POST /api/gmail/send        -> { to, subject, body, threadId? } => { id, threadId, to }
//   POST /api/gmail/replies     -> { threads: [{ leadId, threadId }] } => [{ leadId, snippet }]
//   POST /api/gmail/disconnect
import { NextRequest, NextResponse } from "next/server";
import { authUrl, configured, COOKIE, exchange, fresh, profile, replyIn, revoke, send, type Tokens } from "@/lib/gmail";

export const runtime = "nodejs";

const read = (req: NextRequest): Tokens | null => {
  try {
    const v = req.cookies.get(COOKIE)?.value;
    return v ? (JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as Tokens) : null;
  } catch {
    return null;
  }
};
const write = (res: NextResponse, t: Tokens) =>
  res.cookies.set(COOKIE, Buffer.from(JSON.stringify(t)).toString("base64url"), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });

/** Runs `fn` with fresh tokens and rewrites the cookie if they were refreshed. */
async function withTokens(req: NextRequest, fn: (t: Tokens) => Promise<unknown>) {
  const stored = read(req);
  if (!stored) return NextResponse.json({ error: "Gmail not connected" }, { status: 401 });
  try {
    const { tokens, changed } = await fresh(stored);
    const res = NextResponse.json(await fn(tokens));
    if (changed) write(res, tokens);
    return res;
  } catch (e) {
    console.error("[gmail]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const origin = req.nextUrl.origin;

  if (action === "status") {
    if (!configured()) return NextResponse.json({ configured: false, connected: false });
    const t = read(req);
    if (!t) return NextResponse.json({ configured: true, connected: false });
    return withTokens(req, async (tok) => ({ configured: true, connected: true, email: (await profile(tok)).emailAddress }));
  }

  if (action === "auth") {
    if (!configured()) return NextResponse.json({ error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" }, { status: 501 });
    const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/profile";
    return NextResponse.redirect(authUrl(origin, returnTo.startsWith("/") ? returnTo : "/profile"));
  }

  if (action === "callback") {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state") ?? "/profile";
    const back = new URL(state.startsWith("/") ? state : "/profile", origin);
    if (!code) {
      back.searchParams.set("gmail", "denied");
      return NextResponse.redirect(back);
    }
    try {
      const tokens = await exchange(origin, code);
      back.searchParams.set("gmail", "connected");
      const res = NextResponse.redirect(back);
      write(res, tokens);
      return res;
    } catch (e) {
      console.error("[gmail callback]", e);
      back.searchParams.set("gmail", "error");
      return NextResponse.redirect(back);
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;

  if (action === "disconnect") {
    const t = read(req);
    if (t) await revoke(t);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(COOKIE);
    return res;
  }

  if (action === "send") {
    const m = (await req.json()) as { to: string; subject: string; body: string; threadId?: string };
    // Safety net for demos and tests: every letter goes to GMAIL_DEMO_RECIPIENT instead of the importer.
    // Real importers are only emailed when GMAIL_ALLOW_REAL_SEND=true is set on purpose.
    if (!process.env.GMAIL_DEMO_RECIPIENT && process.env.GMAIL_ALLOW_REAL_SEND !== "true") {
      return NextResponse.json({ error: "Sending is locked: set GMAIL_DEMO_RECIPIENT (test inbox) in .env.local." }, { status: 403 });
    }
    const to = process.env.GMAIL_DEMO_RECIPIENT || m.to;
    if (!to || !/\S+@\S+\.\S+/.test(to)) return NextResponse.json({ error: "No valid recipient" }, { status: 400 });
    return withTokens(req, async (t) => ({ ...(await send(t, { ...m, to })), to }));
  }

  if (action === "replies") {
    const { threads } = (await req.json()) as { threads: { leadId: string; threadId: string }[] };
    return withTokens(req, async (t) => {
      const own = (await profile(t)).emailAddress;
      const found = await Promise.all(threads.map(async (x) => ({ leadId: x.leadId, snippet: await replyIn(t, x.threadId, own).catch(() => null) })));
      return found.filter((f) => f.snippet);
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 404 });
}
