export const ALLOWED_ORIGINS = Object.freeze([
  "https://rawkward.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const ALLOWED = new Set(ALLOWED_ORIGINS);

export function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  return origin && ALLOWED.has(origin) ? origin : null;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(request) {
  const origin = allowedOrigin(request);
  return new Response(null, {
    status: 204,
    headers: origin ? corsHeaders(origin) : { Vary: "Origin" },
  });
}

export function withCors(response, request) {
  const origin = allowedOrigin(request);
  if (!origin) return response;
  const next = new Response(response.body, response);
  for (const [key, value] of Object.entries(corsHeaders(origin))) {
    next.headers.set(key, value);
  }
  return next;
}
