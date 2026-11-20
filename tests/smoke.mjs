// Смоук-тест: собираем страницу в jsdom, подсовываем фейковый сервер на базе воркерной логики
// и проверяем рендер, отметки, добавление, правку, удаление и «второе устройство».
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { applyOps, normalizeState } from "../worker/src/state.js";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require("jsdom");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const notes = fs.readFileSync(path.join(root, "assets", "notes.js"), "utf8");
const api = fs.readFileSync(path.join(root, "assets", "api.js"), "utf8");

html = html.replace('<script src="assets/notes.js"></script>', "<script>" + notes + "</script>");
html = html.replace('<script src="assets/api.js"></script>', "<script>" + api + "</script>");
html = html.replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g, "");

const TOKEN_KEY = "family-notes-token-v1";
const PASSWORD = "kisa2026";
const API_ORIGIN = "https://family-notes-api.rawkward.workers.dev";

/* ─── фейковый бэкенд: та же логика операций, что в воркере ─── */
function makeServer() {
  const server = { rev: 0, data: null };
  async function handle(input, init) {
    const opts = init || {};
    const url = new URL(String(input));
    const method = (opts.method || "GET").toUpperCase();
    const headers = opts.headers || {};
    const body = opts.body ? JSON.parse(opts.body) : null;
    const respond = (payload, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (url.origin !== API_ORIGIN) return respond({ error: "bad_origin" }, 404);
    if (url.pathname === "/api/login" && method === "POST") {
      if (!body || body.password !== PASSWORD) return respond({ error: "wrong_password" }, 403);
      return respond({ token: "test-token", expires_at: 9999999999 });
    }
    if (url.pathname === "/api/state" && method === "GET") {
      if (headers.Authorization !== "Bearer test-token") return respond({ error: "unauthorized" }, 401);
      return respond({ rev: server.rev, updated_at: 0, data: server.data });
    }
    if (url.pathname === "/api/state/init" && method === "POST") {
      server.data = normalizeState(body.data);
      server.rev = 1;
      return respond({ rev: server.rev, updated_at: 0, data: server.data }, 201);
    }
    if (url.pathname === "/api/ops" && method === "POST") {
      if (!server.data) return respond({ error: "not_initialized" }, 409);
      server.data = applyOps(server.data, body.ops);
      server.rev += 1;
      return respond({ rev: server.rev, updated_at: 0, data: server.data });
    }
    return respond({ error: "not_found" }, 404);
  }
  return { server, handle };
}

const { server, handle } = makeServer();

async function bootDevice() {
  const errors = [];
  const virtualConsole = new VirtualConsole().on("jsdomError", (e) => {
    if (!/Not implemented/.test(e.message)) errors.push(e.message);
  });
  virtualConsole.on("error", (msg) => {
    if (!/Not implemented/.test(String(msg))) errors.push(String(msg));
  });
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://localhost/index.html",
    virtualConsole,
    beforeParse(window) {
      window.fetch = (url, init) => handle(url, init);
      try { window.localStorage.setItem(TOKEN_KEY, "test-token"); } catch (e) {}
    },
  });
  await settle();
  return { dom, window: dom.window, document: dom.window.document, errors };
}

async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 20));
}

let ok = true;
function check(name, pass) {
  console.log((pass ? "  ok  " : " FAIL ") + name);
  if (!pass) ok = false;
}

/* ─── первое устройство ─── */
const a = await bootDevice();
const doc = a.document;
const q = (sel) => doc.querySelectorAll(sel);

check("данные с сервера развернулись: 8 групп, 28 пунктов", q("#quests .qcard").length === 8 && q("#quests .qitem").length === 28);
check("прогресс на нуле", doc.getElementById("done-num").textContent === "0");
check("задач бота = 5, одна на паузе", q(".job").length === 5 && q(".st.paused").length === 1);
check("дат = 4", q(".date").length === 4);
check("у дат есть обратный отсчёт", [...q(".date .in")].every((e) => /через|сегодня|завтра/.test(e.textContent)));
check("регулярных дел = 6", q(".reg .r").length === 6);
check("школ = 7", q(".school").length === 7);
check("у каждой школы есть телефон, сайт и карта", [...q(".school")].every((s) => {
  const links = [...s.querySelectorAll(".links a")].map((x) => x.getAttribute("href"));
  return links.some((h) => h.startsWith("https://")) &&
    links.some((h) => h.includes("yandex.ru/maps")) &&
    s.querySelector(".addr a[href^='tel:']");
}));
check("ссылки на сайты школ кликабельные и не пустые", [...q(".school .links a")].filter((x) => x.textContent === "сайт").length === 7);
check("строк расчёта Форсажа = 6", q("#math tr").length === 6);
check("итогов на двоих = 6", q("#totals tr").length === 6);
check("рекомендаций = 5, вопросов = 5", q("#reco li").length === 5 && q("#call li").length === 5);
check("форма пароля скрыта после входа", !doc.getElementById("lock").classList.contains("on"));
check("ошибок JS нет", a.errors.length === 0);
if (a.errors.length) console.log(a.errors.slice(0, 4));

/* ─── отметка уходит на сервер ─── */
const firstBox = doc.querySelector("#quests .qitem input[type=checkbox]");
firstBox.checked = true;
firstBox.dispatchEvent(new a.window.Event("change"));
await settle();
check("отметка сохранилась на сервере", server.data.quests[0].items[0].done === true);
check("прогресс стал 1", doc.getElementById("done-num").textContent === "1");

/* ─── добавление пункта из интерфейса ─── */
const firstCard = doc.querySelector("#quests .qcard");
firstCard.querySelector(".addbtn").click();
await settle(2);
let form = firstCard.querySelector(".inline");
check("форма добавления открылась", !!form);
form.querySelector('[name="t"]').value = "Новый пункт из теста";
form.querySelector('[name="n"]').value = "с уточнением";
form.dispatchEvent(new a.window.Event("submit", { cancelable: true, bubbles: true }));
await settle();
const added = server.data.quests[0].items.at(-1);
check("пункт добавился на сервере", added.t === "Новый пункт из теста" && added.n === "с уточнением");
check("пункт появился в разметке", q("#quests .qitem").length === 29 && doc.body.textContent.includes("Новый пункт из теста"));

/* ─── правка пункта ─── */
const targetRow = [...q("#quests .qitem")].find((r) => r.dataset.id === added.id);
const editBtn = [...targetRow.querySelectorAll(".mini")].find((b) => b.title === "Изменить пункт");
editBtn.click();
await settle(2);
form = targetRow.nextElementSibling;
check("форма правки открылась", !!form && form.classList.contains("inline"));
form.querySelector('[name="t"]').value = "Пункт после правки";
form.dispatchEvent(new a.window.Event("submit", { cancelable: true, bubbles: true }));
await settle();
check("правка дошла до сервера", server.data.quests[0].items.at(-1).t === "Пункт после правки");

/* ─── правка даты и добавление регулярного дела ─── */
const dateCard = doc.querySelector(".date");
[...dateCard.querySelectorAll(".mini")].find((b) => b.title === "Изменить дату").click();
await settle(2);
form = dateCard.nextElementSibling;
form.querySelector('[name="day"]').value = "13";
form.dispatchEvent(new a.window.Event("submit", { cancelable: true, bubbles: true }));
await settle();
check("дата поправилась на сервере", server.data.dates.some((d) => d.day === 13));

doc.getElementById("add-regular").click();
await settle(2);
form = doc.querySelector("#regular .inline");
form.querySelector('[name="title"]').value = "Полить лиану";
form.querySelector('[name="when"]').value = "каждое воскресенье";
form.dispatchEvent(new a.window.Event("submit", { cancelable: true, bubbles: true }));
await settle();
check("регулярное дело добавилось", server.data.regular.some((r) => r.title === "Полить лиану"));
check("в разметке 7 регулярных дел", q(".reg .r").length === 7);
check(
  "разделы регулярных дел идут по порядку",
  [...doc.querySelectorAll("#regular .reggroup h3")].map((e) => e.textContent).join("|") === "Квартира|Кошка|Без раздела",
);

/* ─── доска ─── */
const boardCol = (key) => doc.querySelector('#board .bcol[data-col="' + key + '"]');
const colCards = (key) => [...boardCol(key).querySelectorAll(".bcard")];
const boardCard = (title) => [...doc.querySelectorAll("#board .bcard")].find((c) => c.textContent.includes(title));
const bform = () => doc.querySelector("#board-forms .inline");

await settle();
check(
  "columnOf: статус и исполнитель определяют колонку",
  typeof a.window.columnOf === "function" &&
    a.window.columnOf({ status: "done" }) === "done" &&
    a.window.columnOf({ status: "work" }) === "work" &&
    a.window.columnOf({ status: "open", who: "женя" }) === "женя" &&
    a.window.columnOf({ status: "open", who: "антон" }) === "антон" &&
    a.window.columnOf({ status: "open", who: "" }) === "backlog",
);
check("на доске 2 карточки крона в бэклоге", colCards("backlog").length === 2);
check(
  "у карточек крона есть чип «крон»",
  colCards("backlog").every((c) => [...c.querySelectorAll(".st")].some((s) => s.textContent === "крон")),
);
check(
  "чип «→ в бэклог» только у задач на доске",
  [...doc.querySelectorAll(".job")].filter((j) => [...j.querySelectorAll(".st")].some((s) => s.textContent === "→ в бэклог")).length === 2,
);
const earsCard = boardCard("Проверить уши кошке Кисе");
check("у карточки ушей настоящее описание периодичности", !!earsCard && earsCard.textContent.includes("раз в 4 месяца") && !earsCard.textContent.includes("каждый день"));

doc.getElementById("add-card").click();
await settle(2);
check("форма новой карточки открылась", !!bform());
bform().querySelector('[name="title"]').value = "Карточка из теста";
bform().querySelector('[name="note"]').value = "описание карточки";
bform().dispatchEvent(new a.window.Event("submit", { cancelable: true, bubbles: true }));
await settle();
check("карточка добавилась на сервер", server.data.board.some((c) => c.title === "Карточка из теста"));
check("карточка появилась в бэклоге", colCards("backlog").some((c) => c.textContent.includes("Карточка из теста")));

let cardEl = boardCard("Карточка из теста");
const statusSel = cardEl.querySelectorAll(".bctl select")[0];
statusSel.value = "work";
statusSel.dispatchEvent(new a.window.Event("change"));
await settle();
check("статус «В работе» сохранён на сервере", server.data.board.find((c) => c.title === "Карточка из теста").status === "work");
check("карточка переехала в колонку «В работе»", colCards("work").some((c) => c.textContent.includes("Карточка из теста")));

cardEl = boardCard("Карточка из теста");
const statusSel2 = cardEl.querySelectorAll(".bctl select")[0];
statusSel2.value = "open";
statusSel2.dispatchEvent(new a.window.Event("change"));
await settle();
cardEl = boardCard("Карточка из теста");
const whoSel = cardEl.querySelectorAll(".bctl select")[1];
whoSel.value = "женя";
whoSel.dispatchEvent(new a.window.Event("change"));
await settle();
check("назначение Жене при «Открыто» → колонка «Женя»", colCards("женя").some((c) => c.textContent.includes("Карточка из теста")));

cardEl = boardCard("Карточка из теста");
const statusSel3 = cardEl.querySelectorAll(".bctl select")[0];
statusSel3.value = "done";
statusSel3.dispatchEvent(new a.window.Event("change"));
await settle();
const doneCard = server.data.board.find((c) => c.title === "Карточка из теста");
check("статус «Сделано» → колонка «Сделано»", colCards("done").some((c) => c.textContent.includes("Карточка из теста")));
check("у выполненной карточки есть doneAt", !!doneCard.doneAt);

doc.getElementById("from-quests").click();
await settle(2);
check("форма «Из квестов» открылась", !!bform());
const questRef = bform().querySelector('[name="item"]').value;
bform().dispatchEvent(new a.window.Event("submit", { cancelable: true, bubbles: true }));
await settle();
check(
  "карточка из квестов создана с src=quest",
  server.data.board.some((c) => c.src === "quest" && c.ref === questRef),
);

a.window.confirm = () => true;
const beforeClear = server.data.board.length;
const doneBefore = server.data.board.filter((c) => c.status === "done").length;
doc.getElementById("clear-done").click();
await settle();
check(
  "очистка удалила выполненные карточки",
  doneBefore === 1 && server.data.board.length === beforeClear - doneBefore && server.data.board.every((c) => c.status !== "done"),
);
check(
  "очистка не тронула остальные карточки",
  server.data.board.some((c) => c.src === "quest" && c.ref === questRef) && server.data.board.filter((c) => c.src === "bot").length === 2,
);

/* ─── чек-листа больше нет ─── */
check("вкладки «Чек-лист» нет", !doc.querySelector('[data-view="checklist"]'));
check("секции чек-листа нет", !doc.getElementById("v-checklist"));

/* ─── панель быстрого перехода по группам ─── */
check("чипов столько же, сколько карточек групп (8)", q("#qnav .qnavbtn").length === 8 && q("#qnav .qnavbtn").length === q("#quests .qcard").length);
check("названия чипов совпадают с названиями групп по порядку", [...q("#qnav .qnavbtn .tt")].map((e) => e.textContent).join("|") === [...q("#quests .qcard h3")].map((e) => e.textContent).join("|"));
const firstChip = doc.querySelector("#qnav .qnavbtn");
let chipClickThrew = false;
try { firstChip.click(); } catch (e) { chipClickThrew = true; }
check("клик по первому чипу не бросает исключений", !chipClickThrew);
check("после клика активен именно первый чип", firstChip.classList.contains("on") && q("#qnav .qnavbtn.on").length === 1);
doc.getElementById("show-rest").click();
await settle(2);
doc.getElementById("show-rest").click();
await settle(2);
check("после фильтра «Только невыполненное» и раскрытия чипы не пропадают", q("#qnav .qnavbtn").length === 8 && [...q("#qnav .qnavbtn")].every((b) => b.style.display !== "none"));

/* ─── второе устройство видит то же самое ─── */
const b = await bootDevice();
check("второе устройство видит тот же список", b.document.querySelectorAll("#quests .qitem").length === 29);
check("второе устройство видит ту же отметку", b.document.getElementById("done-num").textContent === "1");
check("второе устройство видит новое регулярное дело", b.document.querySelectorAll(".reg .r").length === 7);
check(
  "второе устройство видит те же карточки доски",
  b.document.querySelectorAll("#board .bcard").length === server.data.board.length && server.data.board.length === 3,
);
check("второе устройство без ошибок JS", b.errors.length === 0);
if (b.errors.length) console.log(b.errors.slice(0, 4));

/* ─── срок карточек ─── */
const isoDay = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = isoDay(new Date());
const pastDate = new Date(); pastDate.setDate(pastDate.getDate() - 3);
const futureDate = new Date(); futureDate.setDate(futureDate.getDate() + 5);
const past = isoDay(pastDate);
const future = isoDay(futureDate);

async function addBoardCard(title, due) {
  doc.getElementById("add-card").click();
  await settle(2);
  const f = bform();
  f.querySelector('[name="title"]').value = title;
  if (due) f.querySelector('[name="due"]').value = due;
  f.dispatchEvent(new a.window.Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}

await addBoardCard("Срок в будущем", future);
check(
  "карточка со сроком сохранилась на сервере",
  server.data.board.some((c) => c.title === "Срок в будущем" && c.due === future),
);
let dueCard = boardCard("Срок в будущем");
let dueBadge = dueCard.querySelector(".bdate");
check(
  "бейдж показывает день.месяц",
  !!dueBadge && dueBadge.textContent === "до " + future.slice(8, 10) + "." + future.slice(5, 7),
);
check("дальний срок без классов soon/over", !!dueBadge && !dueBadge.classList.contains("soon") && !dueBadge.classList.contains("over"));

await addBoardCard("Просроченная карточка", past);
dueCard = boardCard("Просроченная карточка");
dueBadge = dueCard.querySelector(".bdate");
check(
  "прошедший срок сохранился на сервере",
  server.data.board.some((c) => c.title === "Просроченная карточка" && c.due === past),
);
check("прошедший срок получил класс over", !!dueBadge && dueBadge.classList.contains("over"));
const overdueEl = doc.querySelector(".board-actions .overdue-count");
const overdueExpected = server.data.board.filter((c) => c.due && c.due < today).length;
check(
  "счётчик просроченных показывает актуальное число",
  !!overdueEl && overdueEl.textContent === "просрочено: " + overdueExpected && overdueExpected > 0,
);

await addBoardCard("Карточка без срока");
check("карточка без срока рендерится без бейджа", !boardCard("Карточка без срока").querySelector(".bdate"));

check(
  "на каждой карточке ровно один контрол срока",
  [...doc.querySelectorAll("#board .bcard")].every((c) => c.querySelectorAll(".bdate, .bdue-add").length === 1),
);
check(
  "над описанием нет отдельного бейджа срока",
  [...doc.querySelectorAll("#board .bcard")].every(
    (c) => ![...c.children].some((ch) => ch.classList.contains("bdate") || ch.classList.contains("bdue-add")),
  ),
);

let quickCard = boardCard("Карточка без срока");
let quickAdd = quickCard.querySelector(".bdue-add");
check(
  "у карточки без срока есть кнопка ＋ срок и нет .bdate",
  !!quickAdd && quickAdd.textContent === "＋ срок" && !quickCard.querySelector(".bdate"),
);

quickAdd.click();
await settle(2);
quickCard = boardCard("Карточка без срока");
let quickInput = quickCard.querySelector("input.bdue-input");
check("клик по ＋ срок рисует поле даты", !!quickInput && quickInput.type === "date");

quickInput.value = future;
quickInput.dispatchEvent(new a.window.Event("change"));
await settle();
check(
  "срок из быстрой кнопки сохранился на сервере",
  server.data.board.some((c) => c.title === "Карточка без срока" && c.due === future),
);
quickCard = boardCard("Карточка без срока");
check(
  "после ответа на карточке появилась кнопка .bdate",
  !!quickCard.querySelector(".bdate") && !quickCard.querySelector(".bdue-add"),
);

quickCard.querySelector(".bdate").click();
await settle(2);
quickCard = boardCard("Карточка без срока");
quickInput = quickCard.querySelector("input.bdue-input");
check(
  "клик по .bdate рисует поле даты с текущим значением",
  !!quickInput && quickInput.value === future,
);

quickInput.value = "";
quickInput.dispatchEvent(new a.window.Event("change"));
await settle();
check(
  "очистка поля снимает срок на сервере",
  server.data.board.some((c) => c.title === "Карточка без срока" && c.due === ""),
);
quickCard = boardCard("Карточка без срока");
check(
  "после снятия срока снова кнопка ＋ срок",
  !!quickCard.querySelector(".bdue-add") && !quickCard.querySelector(".bdate"),
);

/* ─── вкладки ─── */
let boardClickThrew = false;
try { doc.querySelector('[data-view="board"]').click(); } catch (e) { boardClickThrew = true; }
check("вкладка «Доска» переключается без ошибок", !boardClickThrew && doc.getElementById("v-board").classList.contains("on"));
check("адрес меняется на #board", a.window.location.hash === "#board");

doc.querySelector('[data-view="driving"]').click();
check("вкладка «Автошкола» переключается", doc.getElementById("v-driving").classList.contains("on"));
check("адрес меняется на #driving", a.window.location.hash === "#driving");
check("после операций с доской ошибок JS нет", a.errors.length === 0);
if (a.errors.length) console.log(a.errors.slice(0, 4));

console.log(ok ? "\nALL PASS" : "\nЕСТЬ ПАДЕНИЯ");
process.exit(ok ? 0 : 1);
