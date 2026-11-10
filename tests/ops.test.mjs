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
