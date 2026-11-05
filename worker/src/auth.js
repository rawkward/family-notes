const encoder = new TextEncoder();

export const TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const TOKEN_VERSION = "v1";
const TOKEN_MESSAGE_PREFIX = "family-notes|";

function bytesToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return bytesToHex(digest);
}

export function constantTimeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function verifyPassword(provided, expected) {
  const [providedHash, expectedHash] = await Promise.all([
    sha256Hex(provided === undefined || provided === null ? "" : provided),
    sha256Hex(expected === undefined || expected === null ? "" : expected),
  ]);
  return constantTimeEqual(providedHash, expectedHash);
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(signature);
}

export async function signToken(secret, expiresAt) {
  const exp = String(Math.trunc(expiresAt));
  const signature = await hmacHex(secret, `${TOKEN_MESSAGE_PREFIX}${exp}`);
  return `${TOKEN_VERSION}.${exp}.${signature}`;
}

export async function verifyToken(secret, token, nowSeconds) {
  if (typeof token !== "string" || typeof secret !== "string" || secret === "") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, expRaw, signature] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!/^\d{1,12}$/.test(expRaw)) return null;

  const expected = await hmacHex(secret, `${TOKEN_MESSAGE_PREFIX}${expRaw}`);
  if (!constantTimeEqual(expected, signature)) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= nowSeconds) return null;
  return { expires_at: exp };
}
