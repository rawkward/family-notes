/* Клиент общего хранилища заметок. Бэкенд — Cloudflare Worker + D1. */

const API_BASE = "https://family-notes-api.rawkward.workers.dev";

class NotesApiError extends Error {
  constructor(status, payload) {
    super((payload && (payload.error || payload.message)) || "request_failed");
    this.name = "NotesApiError";
    this.status = status;
    this.payload = payload || {};
  }
}

async function notesRequest(path, options) {
  const opts = options || {};
  const headers = {};
  if (opts.token) headers.Authorization = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch (err) {
    throw new NotesApiError(0, { error: "offline" });
  }
  let data = null;
  try {
    data = await response.json();
  } catch (err) {
    data = null;
  }
  if (!response.ok) throw new NotesApiError(response.status, data);
  return data;
}

const NotesApi = {
  base: API_BASE,
  login(password) {
    return notesRequest("/api/login", { method: "POST", body: { password } });
  },
  getState(token) {
    return notesRequest("/api/state", { token });
  },
  init(token, data) {
    return notesRequest("/api/state/init", { method: "POST", token, body: { data } });
  },
  sendOps(token, ops) {
    return notesRequest("/api/ops", { method: "POST", token, body: { ops } });
  },
};
