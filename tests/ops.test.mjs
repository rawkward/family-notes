// Логика общего состояния: нормализация и операции. Тестируем чистые функции воркера.
import test from "node:test";
import assert from "node:assert/strict";

import { applyOps, normalizeState, ValidationError } from "../worker/src/state.js";

function base() {
  return normalizeState({
    quests: [{ id: "g1", title: "Дом", icon: "🔧", items: [{ id: "i1", t: "Полки", n: "", done: false }, { id: "i2", t: "Шторы", n: "римские", done: true }] }],
    dates: [{ id: "d1", m: 12, day: 30, title: "ДР кисы", who: "киса" }],
    regular: [{ id: "r1", title: "Капли", when: "15-го", note: "", buy: "" }],
  });
}

test("нормализация выдаёт id там, где их нет", () => {
  const state = normalizeState({ quests: [{ title: "Новая", items: [{ t: "Пункт" }] }], dates: [], regular: [] });
  assert.match(state.quests[0].id, /^grp_/);
  assert.match(state.quests[0].items[0].id, /^itm_/);
  assert.equal(state.quests[0].icon, "📌");
  assert.equal(state.quests[0].items[0].done, false);
});

test("нормализация не пропускает пустые тексты", () => {
  assert.throws(() => normalizeState({ quests: [{ title: "   ", items: [] }] }), ValidationError);
  assert.throws(() => normalizeState({ quests: [{ title: "Г", items: [{ t: "" }] }] }), ValidationError);
  assert.throws(() => normalizeState({ dates: [{ m: 13, day: 1, title: "Дата" }] }), ValidationError);
});

test("отметка пункта переключается и не трогает соседей", () => {
  const next = applyOps(base(), [{ type: "quest.toggle", id: "i1" }]);
  assert.equal(next.quests[0].items[0].done, true);
  assert.equal(next.quests[0].items[1].done, true);
  const explicit = applyOps(next, [{ type: "quest.toggle", id: "i2", done: false }]);
  assert.equal(explicit.quests[0].items[1].done, false);
});

test("добавление, правка и удаление пункта", () => {
  const added = applyOps(base(), [{ type: "quest.add", group: "g1", text: "Стеллаж", note: "на балкон" }]);
  const item = added.quests[0].items.at(-1);
  assert.equal(item.t, "Стеллаж");
  assert.equal(item.n, "на балкон");
  assert.match(item.id, /^itm_/);

  const edited = applyOps(added, [{ type: "quest.edit", id: item.id, text: "Стеллаж узкий", note: "" }]);
  assert.equal(edited.quests[0].items.at(-1).t, "Стеллаж узкий");
  assert.equal(edited.quests[0].items.at(-1).n, "");

  const removed = applyOps(edited, [{ type: "quest.del", id: item.id }]);
  assert.equal(removed.quests[0].items.length, 2);
});

test("группы: добавить, переименовать, удалить", () => {
  const added = applyOps(base(), [{ type: "group.add", title: "Дача", icon: "🌿" }]);
  const group = added.quests.at(-1);
  assert.equal(group.title, "Дача");
  assert.equal(group.items.length, 0);

  const renamed = applyOps(added, [{ type: "group.edit", id: group.id, title: "Дача и сад", icon: "🌱" }]);
  assert.equal(renamed.quests.at(-1).title, "Дача и сад");

  const removed = applyOps(renamed, [{ type: "group.del", id: group.id }]);
  assert.equal(removed.quests.length, 1);
});

test("даты: добавить, поправить, удалить", () => {
  const added = applyOps(base(), [{ type: "date.add", m: 2, day: 14, title: "ДР котика", who: "котик" }]);
  const date = added.dates.at(-1);
  assert.equal(date.title, "ДР котика");

  const edited = applyOps(added, [{ type: "date.edit", id: date.id, m: 2, day: 15, title: "ДР котика", who: "котик" }]);
  assert.equal(edited.dates.at(-1).day, 15);

  const removed = applyOps(edited, [{ type: "date.del", id: date.id }]);
  assert.equal(removed.dates.length, 1);
});

test("регулярные дела: добавить, поправить, удалить", () => {
  const added = applyOps(base(), [{ type: "regular.add", title: "Уши", when: "раз в 4 месяца", note: "", buy: "" }]);
  const reg = added.regular.at(-1);
  assert.equal(reg.title, "Уши");

  const edited = applyOps(added, [{ type: "regular.edit", id: reg.id, title: "Уши Кисе", when: "раз в 4 месяца", note: "если грязно", buy: "" }]);
  assert.equal(edited.regular.at(-1).title, "Уши Кисе");

  const removed = applyOps(edited, [{ type: "regular.del", id: reg.id }]);
  assert.equal(removed.regular.length, 1);
});

test("сброс снимает все галочки", () => {
  const next = applyOps(base(), [{ type: "quests.reset" }]);
  assert.equal(next.quests[0].items.every((i) => i.done === false), true);
});

test("плохие операции отбиваются ошибкой", () => {
  assert.throws(() => applyOps(base(), []), ValidationError);
  assert.throws(() => applyOps(base(), [{ type: "wat" }]), ValidationError);
  assert.throws(() => applyOps(base(), [{ type: "quest.toggle", id: "нет-такого" }]), ValidationError);
  assert.throws(() => applyOps(base(), [{ type: "date.add", m: 0, day: 5, title: "Плохо" }]), ValidationError);
  assert.throws(() => applyOps(base(), [{ type: "regular.add", title: "  " }]), ValidationError);
});

test("длинные тексты обрезаются, а не падают", () => {
  const next = applyOps(base(), [{ type: "quest.add", group: "g1", text: "я".repeat(1000), note: "n".repeat(2000) }]);
  const item = next.quests[0].items.at(-1);
  assert.equal(item.t.length, 300);
  assert.equal(item.n.length, 800);
});

test("операции не мутируют исходное состояние", () => {
  const state = base();
  const before = JSON.stringify(state);
  applyOps(state, [{ type: "quest.toggle", id: "i1" }]);
  assert.equal(JSON.stringify(state), before);
});

test("старые чек-листы в записи игнорируются без падения", () => {
  const legacy = {
    quests: [{ id: "g1", title: "Дом", items: [] }],
    dates: [],
    regular: [],
    checklists: [{ id: "lst_1", title: "Сборы", icon: "🧳", items: [{ id: "ltm_1", t: "Паспорт", n: "", done: true }] }],
  };
  const state = normalizeState(legacy);
  assert.equal("checklists" in state, false);

  const next = applyOps(legacy, [{ type: "quests.reset" }]);
  assert.equal("checklists" in next, false);
  assert.equal(next.quests.length, 1);

  assert.throws(() => applyOps(base(), [{ type: "cl.add", title: "Сборы" }]), ValidationError);
});

test("раздел регулярного дела сохраняется по белому списку", () => {
  const state = normalizeState({
    regular: [
      { id: "r1", title: "Коммуналка", cat: "квартира" },
      { id: "r2", title: "Странное", cat: "что-то" },
    ],
  });
  assert.equal(state.regular[0].cat, "квартира");
  assert.equal(state.regular[1].cat, "");

  const added = applyOps(base(), [{ type: "regular.add", title: "Налоги", cat: "квартира" }]);
  assert.equal(added.regular.at(-1).cat, "квартира");

  const edited = applyOps(added, [{ type: "regular.edit", id: added.regular.at(-1).id, title: "Налоги", cat: "семейное" }]);
  assert.equal(edited.regular.at(-1).cat, "семейное");
});

test("доска: нормализация, старые состояния без board", () => {
  const empty = normalizeState({ quests: [], dates: [], regular: [] });
  assert.deepEqual(empty.board, []);

  const state = normalizeState({
    board: [
      { id: "c1", title: "  Карточка  ", note: "n", status: "wat", who: "вова", src: "x", ref: "r", doneAt: "" },
      { title: "Готовая", status: "done" },
    ],
  });
  assert.equal(state.board[0].title, "Карточка");
  assert.equal(state.board[0].note, "n");
  assert.equal(state.board[0].status, "open");
  assert.equal(state.board[0].who, "");
  assert.equal(state.board[0].src, "");
  assert.equal(state.board[0].ref, "r");
  assert.equal(state.board[0].doneAt, "");
  assert.match(state.board[1].id, /^crd_/);
  assert.equal(state.board[1].status, "done");
  assert.equal(state.board[1].doneAt, "");

  assert.throws(() => normalizeState({ board: [{ title: "   " }] }), (e) => e.message === "empty_card");
});

test("board.add: дефолты, обрезка, done сразу с doneAt", () => {
  const next = applyOps(base(), [{ type: "board.add", title: "  Купить хлеб  " }]);
  const card = next.board.at(-1);
  assert.match(card.id, /^crd_/);
  assert.equal(card.title, "Купить хлеб");
  assert.equal(card.note, "");
  assert.equal(card.status, "open");
  assert.equal(card.who, "");
  assert.equal(card.src, "");
  assert.equal(card.ref, "");
  assert.equal(card.doneAt, "");

  const long = applyOps(base(), [{ type: "board.add", title: "t".repeat(400), note: "n".repeat(900), ref: "r".repeat(100) }]);
  const longCard = long.board.at(-1);
  assert.equal(longCard.title.length, 300);
  assert.equal(longCard.note.length, 800);
  assert.equal(longCard.ref.length, 60);

  const done = applyOps(base(), [{ type: "board.add", title: "Готово", status: "done" }]);
  assert.equal(done.board.at(-1).status, "done");
  assert.ok(done.board.at(-1).doneAt && !Number.isNaN(Date.parse(done.board.at(-1).doneAt)));

  assert.throws(() => applyOps(base(), [{ type: "board.add", title: " " }]), (e) => e.message === "empty_card");
});

test("board.add: дубликат src+ref отбивается в любом статусе", () => {
  const first = applyOps(base(), [{ type: "board.add", title: "Из бота", src: "bot", ref: "postel" }]);
  assert.throws(
    () => applyOps(first, [{ type: "board.add", title: "Снова", src: "bot", ref: "postel" }]),
    (e) => e instanceof ValidationError && e.message === "board_duplicate",
  );

  const done = applyOps(first, [{ type: "board.set", id: first.board[0].id, status: "done" }]);
  assert.throws(() => applyOps(done, [{ type: "board.add", title: "Снова", src: "bot", ref: "postel" }]), ValidationError);

  const quest = applyOps(first, [{ type: "board.add", title: "Из квестов", src: "quest", ref: "postel" }]);
  assert.equal(quest.board.length, 2);

  const plain = applyOps(first, [{ type: "board.add", title: "Без ссылки", src: "bot" }]);
  assert.equal(plain.board.length, 2);
});

test("board.edit правит текст и описание", () => {
  const added = applyOps(base(), [{ type: "board.add", title: "Старое", note: "старо" }]);
  const id = added.board[0].id;
  const edited = applyOps(added, [{ type: "board.edit", id, title: " Новое ", note: " новое " }]);
  assert.equal(edited.board[0].title, "Новое");
  assert.equal(edited.board[0].note, "новое");
  assert.throws(() => applyOps(added, [{ type: "board.edit", id, title: " " }]), (e) => e.message === "empty_card");
  assert.throws(() => applyOps(added, [{ type: "board.edit", id: "нет", title: "X" }]), ValidationError);
});

test("board: срок — валидная дата, мусор и правка", () => {
  const added = applyOps(base(), [{ type: "board.add", title: "С датой", due: "2026-11-23" }]);
  assert.equal(added.board.at(-1).due, "2026-11-23");

  const leap = applyOps(base(), [{ type: "board.add", title: "Лип", due: "2024-02-29" }]);
  assert.equal(leap.board.at(-1).due, "2024-02-29");

  for (const bad of ["2026-13-40", "завтра", null, undefined, "2026-02-30", "2023-02-29", " 2026-01-01 ", 20261123]) {
    const next = applyOps(base(), [{ type: "board.add", title: "Мусор", due: bad }]);
    assert.equal(next.board.at(-1).due, "");
  }

  const plain = applyOps(base(), [{ type: "board.add", title: "Без срока" }]);
  const id = plain.board[0].id;
  assert.equal(plain.board[0].due, "");

  const set = applyOps(plain, [{ type: "board.edit", id, title: "Без срока", due: "2026-12-31" }]);
  assert.equal(set.board[0].due, "2026-12-31");

  const changed = applyOps(set, [{ type: "board.edit", id, title: "Без срока", due: "2027-01-05" }]);
  assert.equal(changed.board[0].due, "2027-01-05");

  const removed = applyOps(changed, [{ type: "board.edit", id, title: "Без срока" }]);
  assert.equal(removed.board[0].due, "");

  const garbage = applyOps(set, [{ type: "board.edit", id, title: "Без срока", due: "завтра" }]);
  assert.equal(garbage.board[0].due, "");

  const legacy = normalizeState({ board: [{ id: "c1", title: "Старая карточка" }] });
  assert.equal(legacy.board[0].due, "");
});

test("board.set: статус, исполнитель, doneAt", () => {
  const added = applyOps(base(), [{ type: "board.add", title: "Дело" }]);
  const id = added.board[0].id;

  const work = applyOps(added, [{ type: "board.set", id, status: "work" }]);
  assert.equal(work.board[0].status, "work");
  assert.equal(work.board[0].doneAt, "");

  const done = applyOps(work, [{ type: "board.set", id, status: "done" }]);
  assert.equal(done.board[0].status, "done");
  assert.ok(done.board[0].doneAt);

  const back = applyOps(done, [{ type: "board.set", id, status: "open" }]);
  assert.equal(back.board[0].doneAt, "");

  const assigned = applyOps(added, [{ type: "board.set", id, who: "женя" }]);
  assert.equal(assigned.board[0].who, "женя");

  assert.throws(() => applyOps(added, [{ type: "board.set", id, status: "wat" }]), (e) => e.message === "bad_status");
  assert.throws(() => applyOps(added, [{ type: "board.set", id, who: "вова" }]), (e) => e.message === "bad_who");
  assert.throws(() => applyOps(added, [{ type: "board.set", id: "нет", who: "женя" }]), ValidationError);
});

test("board.del удаляет карточку", () => {
  const added = applyOps(base(), [{ type: "board.add", title: "А" }, { type: "board.add", title: "Б" }]);
  const removed = applyOps(added, [{ type: "board.del", id: added.board[0].id }]);
  assert.equal(removed.board.length, 1);
  assert.equal(removed.board[0].title, "Б");
  assert.throws(() => applyOps(added, [{ type: "board.del", id: "нет" }]), ValidationError);
});

test("board.clearDone: без days чистит все done", () => {
  const added = applyOps(base(), [
    { type: "board.add", title: "Открытая" },
    { type: "board.add", title: "Готовая", status: "done" },
    { type: "board.add", title: "В работе", status: "work" },
  ]);
  const next = applyOps(added, [{ type: "board.clearDone" }]);
  assert.deepEqual(next.board.map((c) => c.title).sort(), ["В работе", "Открытая"].sort());
});

test("board.clearDone с days чистит только старые и без doneAt", () => {
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  const fresh = new Date(Date.now() - 1 * 86400000).toISOString();
  const state = normalizeState({
    board: [
      { id: "c1", title: "Старая", status: "done", doneAt: old },
      { id: "c2", title: "Свежая", status: "done", doneAt: fresh },
      { id: "c3", title: "Без даты", status: "done", doneAt: "" },
      { id: "c4", title: "Обычная" },
    ],
  });
  const next = applyOps(state, [{ type: "board.clearDone", days: 5 }]);
  assert.deepEqual(next.board.map((c) => c.id), ["c2", "c4"]);

  const all = applyOps(state, [{ type: "board.clearDone", days: "нет" }]);
  assert.deepEqual(all.board.map((c) => c.id), ["c4"]);
});

test("board.botsync создаёт недостающие и не дублирует существующие", () => {
  const first = applyOps(base(), [{
    type: "board.botsync",
    jobs: [
      { ref: "postel", title: "Постельное", note: "каждую вторую субботу" },
      { ref: "family-ears", title: "Уши", note: "раз в 4 месяца" },
    ],
  }]);
  assert.equal(first.board.length, 2);
  const card = first.board[0];
  assert.equal(card.src, "bot");
  assert.equal(card.ref, "postel");
  assert.equal(card.title, "Постельное");
  assert.equal(card.note, "каждую вторую субботу");
  assert.equal(card.status, "open");
  assert.equal(card.who, "");
  assert.equal(card.doneAt, "");

  const again = applyOps(first, [{
    type: "board.botsync",
    jobs: [
      { ref: "postel", title: "Постельное" },
      { ref: "new-job", title: "Новое" },
    ],
  }]);
  assert.equal(again.board.length, 3);
  assert.equal(again.board.filter((c) => c.ref === "postel").length, 1);

  const done = applyOps(again, [{ type: "board.set", id: again.board.find((c) => c.ref === "postel").id, status: "done" }]);
  const after = applyOps(done, [{ type: "board.botsync", jobs: [{ ref: "postel", title: "Постельное" }] }]);
  assert.equal(after.board.filter((c) => c.ref === "postel").length, 1);

  const noChange = applyOps(first, [{ type: "board.botsync", jobs: [{ ref: "postel", title: "Постельное" }] }]);
  assert.equal(noChange.board.length, 2);

  assert.throws(() => applyOps(base(), [{ type: "board.botsync", jobs: [] }]), (e) => e.message === "empty_jobs");
  assert.throws(() => applyOps(base(), [{ type: "board.botsync" }]), (e) => e.message === "empty_jobs");
});

test("доска не растёт выше 300 карточек", () => {
  const board = Array.from({ length: 300 }, (_, i) => ({ id: "c" + i, title: "Карточка " + i }));
  const state = normalizeState({ board });
  assert.equal(state.board.length, 300);
  assert.throws(() => applyOps(state, [{ type: "board.add", title: "Лишняя" }]), (e) => e.message === "too_many_board");
  assert.throws(
    () => applyOps(state, [{ type: "board.botsync", jobs: [{ ref: "new", title: "Лишняя" }] }]),
    (e) => e.message === "too_many_board",
  );
});

test("операции доски не мутируют исходное состояние", () => {
  const state = applyOps(base(), [{ type: "board.add", title: "Дело" }]);
  const before = JSON.stringify(state);
  applyOps(state, [{ type: "board.set", id: state.board[0].id, status: "done" }]);
  assert.equal(JSON.stringify(state), before);
});
