// Смоук-тест рендера: собираем страницу в jsdom и проверяем, что всё отрисовалось.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const data = fs.readFileSync(path.join(root, "assets", "notes.js"), "utf8");

// notes.js подставляем инлайном, чтобы jsdom не тянул файл по сети
html = html.replace('<script src="assets/notes.js"></script>', "<script>" + data + "</script>");
// внешний шрифт не нужен для теста
html = html.replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g, "");

const errors = [];
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://localhost/index.html",
  virtualConsole: new (require("jsdom").VirtualConsole)().on("jsdomError", (e) => {
    // jsdom не реализует scrollTo — это ограничение тестовой среды, не страницы
    if (!/Not implemented/.test(e.message)) errors.push(e.message);
  })
});
const { document, window } = dom.window;

const q = (s) => document.querySelectorAll(s);
const checks = [
  ["карточек квестов = 8", q(".qcard").length === 8],
  ["пунктов квестов = 28", q(".qitem").length === 28],
  ["счётчик прогресса стоит на 0", document.getElementById("done-num").textContent === "0"],
  ["задач бота = 4", q(".job").length === 4],
  ["одна из них на паузе", q(".st.paused").length === 1],
  ["дат = 4", q(".date").length === 4],
  ["у дат есть обратный отсчёт", [...q(".date .in")].every((e) => /через|сегодня|завтра/.test(e.textContent))],
  ["регулярных дел = 3", q(".reg .r").length === 3],
  ["школ = 7", q(".school").length === 7],
  ["строк расчёта Форсажа = 6", q("#math tr").length === 6],
  ["итогов на двоих = 6", q("#totals tr").length === 6],
  ["рекомендаций = 5", q("#reco li").length === 5],
  ["вопросов для звонка = 5", q("#call li").length === 5],
  ["нет ошибок JS", errors.length === 0]
];

let ok = true;
for (const [name, pass] of checks) {
  console.log((pass ? "  ok  " : " FAIL ") + name);
  if (!pass) ok = false;
}
if (errors.length) console.log("jsdom errors:", errors);

// проверяем сохранение отметки и прогресс
const first = document.querySelector(".qitem input");
first.checked = true;
first.dispatchEvent(new window.Event("change"));
console.log((document.getElementById("done-num").textContent === "1" ? "  ok  " : " FAIL ") + "отметка обновляет прогресс");
console.log((JSON.parse(window.localStorage.getItem("family-notes-quests-v1")) ? "  ok  " : " FAIL ") + "отметка сохраняется в localStorage");

// переключение вкладок
document.querySelector('[data-view="driving"]').click();
console.log((document.getElementById("v-driving").classList.contains("on") ? "  ok  " : " FAIL ") + "вкладка «Автошкола» переключается");
console.log((window.location.hash === "#driving" ? "  ok  " : " FAIL ") + "адрес меняется на #driving");

process.exit(ok ? 0 : 1);
