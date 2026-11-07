// Разовый сев общего состояния на живом бэкенде из assets/notes.js.
// Запуск: node scripts/seed-live.mjs [пароль]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://family-notes-api.rawkward.workers.dev";
const password = process.argv[2] || "kisa2026";

const source = fs.readFileSync(path.join(root, "assets", "notes.js"), "utf8");
const { QUESTS, DATES, REGULAR, CHECKLISTS } = new Function(source + "\nreturn { QUESTS, DATES, REGULAR, CHECKLISTS };")();

const data = {
  quests: QUESTS.map((g) => ({
    id: g.id,
    title: g.title,
    icon: g.icon,
    items: g.items.map((it, i) => ({ id: g.id + "-" + i, t: it.t, n: it.n || "", done: false })),
  })),
  dates: DATES.map((d, i) => ({ id: "date-" + i, m: d.m, day: d.day, title: d.title, who: d.who || "" })),
  regular: REGULAR.map((r, i) => ({ id: "reg-" + i, title: r.title, when: r.when || "", note: r.note || "", buy: r.buy || "" })),
  checklists: CHECKLISTS.map((list) => ({
    id: list.id,
    title: list.title,
    icon: list.icon,
    items: list.items.map((it, i) => ({ id: list.id + "-" + i, t: it.t, n: it.n || "", done: false })),
  })),
};

const login = await fetch(API + "/api/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error("login failed: " + login.status);
const { token } = await login.json();

const current = await fetch(API + "/api/state", { headers: { Authorization: "Bearer " + token } });
const state = await current.json();
if (state.data) {
  console.log("Состояние уже есть, rev=" + state.rev + " — сев не нужен.");
} else {
  const init = await fetch(API + "/api/state/init", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ data }),
  });
  const created = await init.json();
  console.log("Сев выполнен: rev=" + created.rev + ", групп=" + created.data.quests.length + ", дат=" + created.data.dates.length);
}

const after = await fetch(API + "/api/state", { headers: { Authorization: "Bearer " + token } });
const final = await after.json();
console.log("На сервере: rev=" + final.rev + ", групп=" + final.data.quests.length +
  ", пунктов=" + final.data.quests.reduce((n, g) => n + g.items.length, 0) +
  ", дат=" + final.data.dates.length + ", регулярных=" + final.data.regular.length);
