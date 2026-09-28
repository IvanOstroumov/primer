// Мелкие помощники: DOM, даты, числа.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Даты: храним 'YYYY-MM-DD' в локальном времени
export function isoDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const dayMs = 86400000;
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / dayMs);
}
export function addDays(s, n) {
  const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d);
}
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const WEEKDAYS_SHORT = WD;
export function fmtDate(s, withWd = false) {
  const d = parseDate(s);
  return (withWd ? WD[d.getDay()] + ', ' : '') + d.getDate() + ' ' + MONTHS[d.getMonth()];
}
export function fmtDateFull(s) {
  const d = parseDate(s);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}
// Понедельник недели для даты
export function weekStart(s) {
  const d = parseDate(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDate(d);
}

export function num(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
export function fmtNum(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(r).replace('.', ',');
}
export function fmtRest(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}:${String(s).padStart(2, '0')}` : `${m}:00`;
}
export function restLabel(a, b) {
  const f = s => (s % 60 === 0 ? String(s / 60) : String(s / 60).replace('.', ','));
  return a === b ? `${f(a)} мин` : `${f(a)}–${f(b)} мин`;
}
export function range(a, b) { return a === b ? String(a) : `${a}–${b}`; }

export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Эпли: оценка 1ПМ
export const e1rm = (w, r) => (w && r ? w * (1 + r / 30) : 0);

// Сообщение с кнопкой «Отменить» (5 секунд)
export function undoToast(msg, undo) {
  let t = document.getElementById('undo');
  if (!t) { t = h('div', { id: 'undo', role: 'status' }); document.body.append(t); }
  clearTimeout(t._h);
  t.replaceChildren(h('span', {}, msg), h('button', {
    type: 'button', onclick: () => { clearTimeout(t._h); t.classList.remove('show'); undo(); },
  }, '↶ Отменить'));
  t.classList.add('show');
  t._h = setTimeout(() => t.classList.remove('show'), 5000);
}

export function fmtDuration(min) {
  if (min == null) return '';
  const hh = Math.floor(min / 60), mm = min % 60;
  return hh ? `${hh} ч ${mm} мин` : `${mm} мин`;
}
