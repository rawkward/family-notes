// Живой end-to-end прогон: берём настоящий деплой с GitHub Pages, логинимся паролем,
// проверяем, что данные пришли с живого API, ставим и снимаем отметку, правим чек-лист.
import { createRequire } from "node:module";

const require = createRequire("C:/Users/user/hermes-projects/family-notes/package.json");
const { JSDOM, VirtualConsole } = require("jsdom");

const SITE = "https://rawkward.github.io/family-notes/";
const API = "https://family-notes-api.rawkward.workers.dev";
const PASSWORD = "kisa2026";
const UA = "family-notes-live-check";

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
const waitFor = async (fn, n = 20) => {
  for (let i = 0; i < n; i += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
let ok = true;
const check = (name, pass) => { console.log((pass ? "  ok  " : " FAIL ") + name); if (!pass) ok = false; };

await settle(4);
check("без пароля показывается замок", document.getElementById("lock").classList.contains("on"));
check("замок мешает видеть прогресс? — нет, данные локальные", document.querySelectorAll("#quests .qcard").length === 8);

// вход настоящим паролем
document.getElementById("lock-pass").value = PASSWORD;
document.getElementById("lock-form").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
await settle(12);
check("вход по паролю прошёл, замок закрылся", !document.getElementById("lock").classList.contains("on"));
check("статус «общее»", document.getElementById("sync").classList.contains("ok"));
check("с сервера пришли 8 групп и 28 пунктов",
  document.querySelectorAll("#quests .qcard").length === 8 && document.querySelectorAll("#quests .qitem").length === 28);

// отметка на живом сервере
const box = document.querySelector('#quests .qitem[data-id="tech-0"] input[type=checkbox]');
box.checked = true;
box.dispatchEvent(new window.Event("change"));
await settle(8);
check("отметка применилась в интерфейсе", document.getElementById("done-num").textContent === "1");

const token = window.localStorage.getItem("family-notes-token-v1");
const apiHeaders = () => ({ Authorization: "Bearer " + token, "user-agent": UA });
const getState = async () => (await fetch(API + "/api/state", { headers: apiHeaders() })).json();

const live = await getState();
check("отметка видна на сервере — значит, её увидит и телефон",
  live.data.quests.find((g) => g.id === "tech").items.find((i) => i.id === "tech-0").done === true);

// снимаем за собой
box.checked = false;
box.dispatchEvent(new window.Event("change"));
await settle(8);
const after = await getState();
check("отметку сняли, состояние чистое",
  after.data.quests.find((g) => g.id === "tech").items.find((i) => i.id === "tech-0").done === false);

// ───────── вкладка «Чек-лист» ─────────
document.querySelector('[data-view="checklist"]').click();
await settle(2);
check("вкладка «Чек-лист» открылась",
  document.getElementById("v-checklist").classList.contains("on"));
check("hash переключился на #checklist", window.location.hash === "#checklist");

const clCards = [...document.querySelectorAll("#checklists .qcard[data-list]")];
const clItems = [...document.querySelectorAll("#checklists .qitem")];
check("в чек-листе ровно 2 списка", clCards.length === 2);
check("в списках не меньше 15 пунктов суммарно", clItems.length >= 15);
check("у каждого списка есть непустое название",
  clCards.every((card) => (card.querySelector("header h3")?.textContent || "").trim().length > 0));
check("ни у одного пункта нет пустого текста",
  clItems.every((item) => (item.querySelector(".txt")?.textContent || "").trim().length > 0));

const clCard = clCards[0];
const clListId = clCard.dataset.list;
const cntOf = (card) => {
  const el = card.querySelector('[data-cl-cnt="' + card.dataset.list + '"]');
  const total = ((el && el.textContent) || "").split("/")[1];
  return Number(total);
};
const clTotalBefore = cntOf(clCard);

// добавление пункта через живую форму
clCard.querySelector(".addbtn").click();
await settle(2);
const addForm = clCard.querySelector(".inline");
check("форма добавления пункта открылась", !!addForm);
if (addForm) {
  addForm.querySelector('[name="t"]').value = "Тестовый пункт чек-листа";
  addForm.querySelector('[name="n"]').value = "проверка живой страницы";
  addForm.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
}
const added = await waitFor(async () => {
  const s = await getState();
  const list = s.data.checklists.find((l) => l.id === clListId);
  return (list && list.items.find((i) => i.t === "Тестовый пункт чек-листа")) || null;
}, 24);
const addedId = added && added.id;
await settle(3);
check("пункт появился на сервере", !!addedId);
check("пункт появился в разметке",
  !!addedId && !!document.querySelector('#checklists .qitem[data-id="' + addedId + '"]'));
check("счётчик пунктов в шапке карточки вырос", cntOf(document.querySelector('#checklists .qcard[data-list="' + clListId + '"]')) > clTotalBefore);

// правка пункта
const editRow = addedId && document.querySelector('#checklists .qitem[data-id="' + addedId + '"]');
if (editRow) editRow.querySelector('.mini[title="Изменить пункт"]').click();
await settle(2);
const editForm = editRow && editRow.nextElementSibling && editRow.nextElementSibling.classList.contains("inline")
  ? editRow.nextElementSibling
  : null;
check("форма правки пункта открылась", !!editForm);
if (editForm) {
  editForm.querySelector('[name="t"]').value = "Тестовый пункт после правки";
  editForm.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
}
const edited = await waitFor(async () => {
  const s = await getState();
  const list = s.data.checklists.find((l) => l.id === clListId);
  const item = list && list.items.find((i) => i.id === addedId);
  return !!(item && item.t === "Тестовый пункт после правки");
}, 24);
check("на сервере именно новый текст пункта", edited);
await settle(3);

// галочка и снятие
const toggle = async (done) => {
  const row = document.querySelector('#checklists .qitem[data-id="' + addedId + '"]');
  if (!row) return false;
  const cb = row.querySelector('input[type=checkbox]');
  cb.checked = done;
  cb.dispatchEvent(new window.Event("change"));
  return waitFor(async () => {
    const s = await getState();
    const list = s.data.checklists.find((l) => l.id === clListId);
    const item = list && list.items.find((i) => i.id === addedId);
    return !!item && item.done === done;
  }, 24);
};
check("галочка на сервере — done: true", await toggle(true));
check("галочка снята на сервере — done: false", await toggle(false));

// убираем за собой через API: window.confirm в jsdom не работает
const delRes = await fetch(API + "/api/ops", {
  method: "POST",
  headers: { ...apiHeaders(), "content-type": "application/json" },
  body: JSON.stringify({ ops: [{ type: "cl.item.del", id: addedId }] }),
});
check("удаление тестового пункта принято сервером", delRes.ok);

const finalState = await waitFor(async () => {
  const s = await getState();
  const list = s.data.checklists.find((l) => l.id === clListId);
  const testGone = !s.data.checklists.some((l) => l.items.some((i) => (i.t || "").includes("Тестовый пункт")));
  return !!(list && list.items.length === 16 && testGone) && s;
}, 24);
const final = finalState || await getState();
const byTitle = (title) => (final.data.checklists.find((l) => l.title === title) || { items: [] }).items.length;
check("в состоянии снова 16 + 5 пунктов",
  byTitle("Сборы в Китай") === 16 && byTitle("Покупки домой") === 5);
check("тестового текста в состоянии нет",
  !final.data.checklists.some((l) => l.items.some((i) => (i.t || "").includes("Тестовый пункт"))));

check("ошибок JS на живой странице нет", errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));

console.log(ok ? "\nLIVE ALL PASS" : "\nLIVE: ЕСТЬ ПАДЕНИЯ");
process.exit(ok ? 0 : 1);
