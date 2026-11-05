// Живой end-to-end прогон: берём настоящий деплой с GitHub Pages, логинимся паролем,
// проверяем, что данные пришли с живого API, ставим и снимаем отметку.
import { createRequire } from "node:module";

const require = createRequire("C:/Users/user/hermes-projects/family-notes/package.json");
const { JSDOM, VirtualConsole } = require("jsdom");

const SITE = "https://rawkward.github.io/family-notes/";
const PASSWORD = "kisa2026";

let html = await (await fetch(SITE)).text();
const notesJs = await (await fetch(SITE + "assets/notes.js")).text();
const apiJs = await (await fetch(SITE + "assets/api.js")).text();
html = html.replace('<script src="assets/notes.js"></script>', "<script>" + notesJs + "</script>");
html = html.replace('<script src="assets/api.js"></script>', "<script>" + apiJs + "</script>");
html = html.replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g, "");

const errors = [];
const vc = new VirtualConsole().on("jsdomError", (e) => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: SITE,
  virtualConsole: vc,
  beforeParse(window) { window.fetch = (u, i) => fetch(String(u), i); },
});
const { document, window } = dom.window;

const settle = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 250)); };
let ok = true;
const check = (name, pass) => { console.log((pass ? "  ok  " : " FAIL ") + name); if (!pass) ok = false; };

await settle(4);
check("без пароля показывается замок", document.getElementById("lock").classList.contains("on"));
check("замок мешает видеть прогресс? — нет, данные локальные", document.querySelectorAll(".qcard").length === 8);

// вход настоящим паролем
document.getElementById("lock-pass").value = PASSWORD;
document.getElementById("lock-form").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
await settle(12);
check("вход по паролю прошёл, замок закрылся", !document.getElementById("lock").classList.contains("on"));
check("статус «общее»", document.getElementById("sync").classList.contains("ok"));
check("с сервера пришли 8 групп и 28 пунктов",
  document.querySelectorAll(".qcard").length === 8 && document.querySelectorAll(".qitem").length === 28);

// отметка на живом сервере
const box = document.querySelector('.qitem[data-id="tech-0"] input[type=checkbox]');
box.checked = true;
box.dispatchEvent(new window.Event("change"));
await settle(8);
check("отметка применилась в интерфейсе", document.getElementById("done-num").textContent === "1");

const token = window.localStorage.getItem("family-notes-token-v1");
const live = await (await fetch("https://family-notes-api.rawkward.workers.dev/api/state", {
  headers: { Authorization: "Bearer " + token },
})).json();
check("отметка видна на сервере — значит, её увидит и телефон",
  live.data.quests.find((g) => g.id === "tech").items.find((i) => i.id === "tech-0").done === true);

// снимаем за собой
box.checked = false;
box.dispatchEvent(new window.Event("change"));
await settle(8);
const after = await (await fetch("https://family-notes-api.rawkward.workers.dev/api/state", {
  headers: { Authorization: "Bearer " + token },
})).json();
check("отметку сняли, состояние чистое",
  after.data.quests.find((g) => g.id === "tech").items.find((i) => i.id === "tech-0").done === false);
check("ошибок JS на живой странице нет", errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));

console.log(ok ? "\nLIVE ALL PASS" : "\nLIVE: ЕСТЬ ПАДЕНИЯ");
process.exit(ok ? 0 : 1);
