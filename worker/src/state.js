// Чистая логика общего состояния заметок (квесты, чек-листы, даты, регулярные дела):
// нормализация и применение операций. Файл не трогает сеть и БД — его же гоняют тесты.

export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

const LIMITS = {
  text: 300,
  note: 800,
  groups: 80,
  checklists: 40,
  items: 400,
  dates: 200,
  regular: 200,
  ops: 100,
};

function text(value, max = LIMITS.text) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function newId(prefix) {
  const raw = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
  return `${prefix}_${raw.replace(/-/g, "").slice(0, 10)}`;
}

function intIn(value, min, max, field) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new ValidationError("bad_number", [{ field, message: `ожидалось число ${min}..${max}` }]);
  }
  return num;
}

export function emptyState() {
  return { quests: [], dates: [], regular: [], checklists: [] };
}

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

function normalizeItem(raw, prefix) {
  const item = raw && typeof raw === "object" ? raw : {};
  const title = text(item.t !== undefined ? item.t : item.title);
  if (!title) throw new ValidationError("empty_item", [{ field: "t", message: "пустой текст пункта" }]);
  return {
    id: typeof item.id === "string" && item.id ? item.id.slice(0, 40) : newId(prefix),
    t: title,
    n: text(item.n !== undefined ? item.n : item.note, LIMITS.note),
    done: item.done === true,
  };
}

function normalizeGroup(raw) {
  const group = raw && typeof raw === "object" ? raw : {};
  const title = text(group.title);
  if (!title) throw new ValidationError("empty_group", [{ field: "title", message: "пустая группа" }]);
  const items = Array.isArray(group.items) ? group.items : [];
  return {
    id: typeof group.id === "string" && group.id ? group.id.slice(0, 40) : newId("grp"),
    title,
    icon: text(group.icon, 8) || "📌",
    items: items.slice(0, LIMITS.items).map((item) => normalizeItem(item, "itm")),
  };
}

function normalizeChecklist(raw) {
  const list = raw && typeof raw === "object" ? raw : {};
  const title = text(list.title);
  if (!title) throw new ValidationError("empty_checklist", [{ field: "title", message: "пустой список" }]);
  const items = Array.isArray(list.items) ? list.items : [];
  return {
    id: typeof list.id === "string" && list.id ? list.id.slice(0, 40) : newId("lst"),
    title,
    icon: text(list.icon, 8) || "✅",
    items: items.slice(0, LIMITS.items).map((item) => normalizeItem(item, "ltm")),
  };
}

function normalizeDate(raw) {
  const date = raw && typeof raw === "object" ? raw : {};
  const title = text(date.title);
  if (!title) throw new ValidationError("empty_date", [{ field: "title", message: "пустая дата" }]);
  return {
    id: typeof date.id === "string" && date.id ? date.id.slice(0, 40) : newId("dat"),
    m: intIn(date.m, 1, 12, "m"),
    day: intIn(date.day, 1, 31, "day"),
    title,
    who: text(date.who, 40),
  };
}

function normalizeRegular(raw) {
  const reg = raw && typeof raw === "object" ? raw : {};
  const title = text(reg.title);
  if (!title) throw new ValidationError("empty_regular", [{ field: "title", message: "пустое дело" }]);
  return {
    id: typeof reg.id === "string" && reg.id ? reg.id.slice(0, 40) : newId("reg"),
    title,
    when: text(reg.when, LIMITS.text),
    note: text(reg.note, LIMITS.note),
    buy: text(reg.buy, LIMITS.text),
  };
}

export function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  const quests = Array.isArray(state.quests) ? state.quests : [];
  const dates = Array.isArray(state.dates) ? state.dates : [];
  const regular = Array.isArray(state.regular) ? state.regular : [];
  const checklists = Array.isArray(state.checklists) ? state.checklists : [];
  return {
    quests: quests.slice(0, LIMITS.groups).map(normalizeGroup),
    dates: dates.slice(0, LIMITS.dates).map(normalizeDate),
    regular: regular.slice(0, LIMITS.regular).map(normalizeRegular),
    checklists: checklists.slice(0, LIMITS.checklists).map(normalizeChecklist),
  };
}

function findGroup(state, groupId) {
  const group = state.quests.find((g) => g.id === groupId);
  if (!group) throw new ValidationError("group_not_found", [{ field: "group", message: "группа не найдена" }]);
  return group;
}

function findItem(state, itemId) {
  for (const group of state.quests) {
    const item = group.items.find((i) => i.id === itemId);
    if (item) return { group, item };
  }
  throw new ValidationError("item_not_found", [{ field: "id", message: "пункт не найден" }]);
}

function findChecklist(state, listId) {
  const list = state.checklists.find((l) => l.id === listId);
  if (!list) throw new ValidationError("checklist_not_found", [{ field: "id", message: "список не найден" }]);
  return list;
}

function findChecklistItem(state, itemId) {
  for (const list of state.checklists) {
    const item = list.items.find((i) => i.id === itemId);
    if (item) return { list, item };
  }
  throw new ValidationError("cl_item_not_found", [{ field: "id", message: "пункт списка не найден" }]);
}

function uniqueId(prefix, used) {
  let id = newId(prefix);
  while (used.has(id)) id = newId(prefix);
  used.add(id);
  return id;
}

export function applyOps(state, ops) {
  if (!Array.isArray(ops) || ops.length === 0) throw new ValidationError("empty_ops");
  if (ops.length > LIMITS.ops) throw new ValidationError("too_many_ops");

  const next = clone(state);
  if (!Array.isArray(next.checklists)) next.checklists = [];
  const usedIds = new Set();
  for (const group of next.quests) {
    usedIds.add(group.id);
    for (const item of group.items) usedIds.add(item.id);
  }
  for (const date of next.dates) usedIds.add(date.id);
  for (const reg of next.regular) usedIds.add(reg.id);
  for (const list of next.checklists) {
    usedIds.add(list.id);
    for (const item of list.items) usedIds.add(item.id);
  }

  for (const raw of ops) {
    const op = raw && typeof raw === "object" ? raw : {};
    switch (op.type) {
      case "quest.toggle": {
        const { item } = findItem(next, op.id);
        item.done = typeof op.done === "boolean" ? op.done : !item.done;
        break;
      }
      case "quest.add": {
        const group = findGroup(next, op.group);
        if (group.items.length >= LIMITS.items) throw new ValidationError("group_full");
        group.items.push(normalizeItem({ t: op.text, n: op.note }, "itm"));
        break;
      }
      case "quest.edit": {
        const { item } = findItem(next, op.id);
        const title = text(op.text);
        if (!title) throw new ValidationError("empty_item", [{ field: "text", message: "пустой текст" }]);
        item.t = title;
        item.n = text(op.note, LIMITS.note);
        break;
      }
      case "quest.del": {
        const { group, item } = findItem(next, op.id);
        group.items = group.items.filter((i) => i.id !== item.id);
        break;
      }
      case "group.add": {
        if (next.quests.length >= LIMITS.groups) throw new ValidationError("too_many_groups");
        const title = text(op.title);
        if (!title) throw new ValidationError("empty_group", [{ field: "title", message: "пустое название" }]);
        next.quests.push({ id: uniqueId("grp", usedIds), title, icon: text(op.icon, 8) || "📌", items: [] });
        break;
      }
      case "group.edit": {
        const group = findGroup(next, op.id);
        const title = text(op.title);
        if (!title) throw new ValidationError("empty_group", [{ field: "title", message: "пустое название" }]);
        group.title = title;
        group.icon = text(op.icon, 8) || "📌";
        break;
      }
      case "group.del": {
        const group = findGroup(next, op.id);
        next.quests = next.quests.filter((g) => g.id !== group.id);
        break;
      }
      case "quests.reset": {
        for (const group of next.quests) for (const item of group.items) item.done = false;
        break;
      }
      case "date.add": {
        if (next.dates.length >= LIMITS.dates) throw new ValidationError("too_many_dates");
        next.dates.push(normalizeDate({ ...op, id: uniqueId("dat", usedIds) }));
        break;
      }
      case "date.edit": {
        const date = next.dates.find((d) => d.id === op.id);
        if (!date) throw new ValidationError("date_not_found");
        const fresh = normalizeDate({ m: op.m, day: op.day, title: op.title, who: op.who, id: date.id });
        Object.assign(date, fresh);
        break;
      }
      case "date.del": {
        const before = next.dates.length;
        next.dates = next.dates.filter((d) => d.id !== op.id);
        if (next.dates.length === before) throw new ValidationError("date_not_found");
        break;
      }
      case "regular.add": {
        if (next.regular.length >= LIMITS.regular) throw new ValidationError("too_many_regular");
        next.regular.push(normalizeRegular({ ...op, id: uniqueId("reg", usedIds) }));
        break;
      }
      case "regular.edit": {
        const reg = next.regular.find((r) => r.id === op.id);
        if (!reg) throw new ValidationError("regular_not_found");
        Object.assign(reg, normalizeRegular({ title: op.title, when: op.when, note: op.note, buy: op.buy, id: reg.id }));
        break;
      }
      case "regular.del": {
        const before = next.regular.length;
        next.regular = next.regular.filter((r) => r.id !== op.id);
        if (next.regular.length === before) throw new ValidationError("regular_not_found");
        break;
      }
      case "cl.add": {
        if (next.checklists.length >= LIMITS.checklists) throw new ValidationError("too_many_checklists");
        const title = text(op.title);
        if (!title) throw new ValidationError("empty_checklist", [{ field: "title", message: "пустое название" }]);
        next.checklists.push({ id: uniqueId("lst", usedIds), title, icon: text(op.icon, 8) || "✅", items: [] });
        break;
      }
      case "cl.edit": {
        const list = findChecklist(next, op.id);
        const title = text(op.title);
        if (!title) throw new ValidationError("empty_checklist", [{ field: "title", message: "пустое название" }]);
        list.title = title;
        list.icon = text(op.icon, 8) || "✅";
        break;
      }
      case "cl.del": {
        const list = findChecklist(next, op.id);
        next.checklists = next.checklists.filter((l) => l.id !== list.id);
        break;
      }
      case "cl.item.add": {
        const list = findChecklist(next, op.list);
        if (list.items.length >= LIMITS.items) throw new ValidationError("checklist_full");
        const id = uniqueId("ltm", usedIds);
        list.items.push(normalizeItem({ id, t: op.text, n: op.note }, "ltm"));
        break;
      }
      case "cl.item.edit": {
        const { item } = findChecklistItem(next, op.id);
        const title = text(op.text);
        if (!title) throw new ValidationError("empty_item", [{ field: "text", message: "пустой текст" }]);
        item.t = title;
        item.n = text(op.note, LIMITS.note);
        break;
      }
      case "cl.item.del": {
        const { list, item } = findChecklistItem(next, op.id);
        list.items = list.items.filter((i) => i.id !== item.id);
        break;
      }
      case "cl.item.toggle": {
        const { item } = findChecklistItem(next, op.id);
        item.done = typeof op.done === "boolean" ? op.done : !item.done;
        break;
      }
      case "cl.reset": {
        if (op.id) {
          const list = findChecklist(next, op.id);
          for (const item of list.items) item.done = false;
        } else {
          for (const list of next.checklists) for (const item of list.items) item.done = false;
        }
        break;
      }
      default:
        throw new ValidationError("unknown_op", [{ field: "type", message: String(op.type) }]);
    }
  }
  return next;
}
