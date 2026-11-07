import { applyOps, normalizeState, ValidationError } from "./state.js";
import { preflight, withCors } from "./cors.js";
import { signToken, verifyPassword, verifyToken, TOKEN_TTL_SECONDS } from "./auth.js";

const MAX_BODY_BYTES = 96 * 1024;
const THROTTLE_WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES = 8;
const PRUNE_WINDOW_SECONDS = 24 * 60 * 60;
const ROW_ID = "main";

class HttpError extends Error {
  constructor(status, payload) {
    super((payload && payload.error) || "http_error");
    this.name = "HttpError";
    this.status = status;
    this.payload = payload;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function errorResponse(err) {
  if (err instanceof HttpError) return json(err.payload, err.status);
  if (err instanceof ValidationError) {
    return json(
      {
        error: "validation",
        details: err.details && err.details.length ? err.details : [{ code: err.message, message: err.message }],
      },
      422,
    );
  }
  console.error("unhandled error:", err && err.message);
  return json({ error: "internal" }, 500);
}

async function readJsonBody(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) throw new HttpError(413, { error: "body_too_large" });
  if (raw.trim() === "") throw new HttpError(400, { error: "bad_json" });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new HttpError(400, { error: "bad_json" });
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, { error: "bad_json" });
  return data;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function requireAuth(request, env) {
  if (!env.TOKEN_SECRET) throw new HttpError(500, { error: "server_misconfigured" });
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw new HttpError(401, { error: "unauthorized" });
  const payload = await verifyToken(env.TOKEN_SECRET, match[1], nowSeconds());
  if (!payload) throw new HttpError(401, { error: "unauthorized" });
  return payload;
}

async function readRow(env) {
  return env.DB.prepare("SELECT json, rev, updated_at FROM state WHERE id = ?").bind(ROW_ID).first();
}

async function writeRow(env, data) {
  const current = await readRow(env);
  const rev = (current ? current.rev : 0) + 1;
  const updatedAt = nowSeconds();
  await env.DB.prepare(
    "INSERT INTO state (id, json, rev, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, rev = excluded.rev, updated_at = excluded.updated_at",
  )
    .bind(ROW_ID, JSON.stringify(data), rev, updatedAt)
    .run();
  return { rev, updated_at: updatedAt };
}

async function handleLogin(request, env) {
  if (!env.FAMILY_PASSWORD || !env.TOKEN_SECRET) throw new HttpError(500, { error: "server_misconfigured" });
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = nowSeconds();
  await env.DB.prepare("DELETE FROM login_attempts WHERE ts < ?").bind(now - PRUNE_WINDOW_SECONDS).run();
  const failures = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts >= ?")
    .bind(ip, now - THROTTLE_WINDOW_SECONDS)
    .first();
  if (failures && failures.n >= MAX_FAILURES) {
    const first = await env.DB.prepare("SELECT MIN(ts) AS ts FROM login_attempts WHERE ip = ? AND ts >= ?")
      .bind(ip, now - THROTTLE_WINDOW_SECONDS)
      .first();
    const retryAfter = Math.max(1, Math.ceil((first && first.ts ? first.ts : now) + THROTTLE_WINDOW_SECONDS - now));
    throw new HttpError(429, { error: "too_many_attempts", retry_after: retryAfter });
  }

  const body = await readJsonBody(request);
  const ok = await verifyPassword(typeof body.password === "string" ? body.password : "", env.FAMILY_PASSWORD);
  if (!ok) {
    await env.DB.prepare("INSERT INTO login_attempts (ip, ts) VALUES (?, ?)").bind(ip, now).run();
    throw new HttpError(403, { error: "wrong_password" });
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  const expiresAt = now + TOKEN_TTL_SECONDS;
  return json({ token: await signToken(env.TOKEN_SECRET, expiresAt), expires_at: expiresAt });
}

async function handleGetState(env) {
  const row = await readRow(env);
  if (!row) return json({ rev: 0, updated_at: 0, data: null });
  const data = JSON.parse(row.json);
  delete data.checklists;
  return json({ rev: row.rev, updated_at: row.updated_at, data });
}

async function handleInit(request, env) {
  const existing = await readRow(env);
  if (existing) {
    throw new HttpError(409, { error: "already_initialized", rev: existing.rev, data: JSON.parse(existing.json) });
  }
  const body = await readJsonBody(request);
  const state = normalizeState(body.data);
  const meta = await writeRow(env, state);
  return json({ ...meta, data: state }, 201);
}

async function handleOps(request, env) {
  const body = await readJsonBody(request);
  const row = await readRow(env);
  if (!row) throw new HttpError(409, { error: "not_initialized" });
  const state = JSON.parse(row.json);
  const next = applyOps(state, body.ops);
  const meta = await writeRow(env, next);
  return json({ ...meta, data: next });
}

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (method === "OPTIONS") return preflight(request);
  if (pathname === "/api/health" && method === "GET") return json({ ok: true, service: "family-notes" });
  if (pathname === "/api/login" && method === "POST") return handleLogin(request, env);
  if (!pathname.startsWith("/api/")) throw new HttpError(404, { error: "not_found" });

  await requireAuth(request, env);

  if (pathname === "/api/state" && method === "GET") return handleGetState(env);
  if (pathname === "/api/state/init" && method === "POST") return handleInit(request, env);
  if (pathname === "/api/ops" && method === "POST") return handleOps(request, env);

  throw new HttpError(404, { error: "bad_route" });
}

export default {
  async fetch(request, env) {
    let response;
    try {
      response = await route(request, env);
    } catch (err) {
      response = errorResponse(err);
    }
    return withCors(response, request);
  },
};
