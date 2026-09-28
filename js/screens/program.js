// Редактор программы. История тренировок хранит свои снимки, поэтому правки её не ломают.
import { h, uid, range, restLabel, toast, WEEKDAYS_SHORT } from '../util.js';
import { state, saveProgram, allWorkouts } from '../state.js';
import { isoDate, weekStart, addDays, fmtDate } from '../util.js';
import { MUSCLES, defaultProgram } from '../seed.js';
import { KINDS } from './today.js';

let openEx = null;
let curDay = null;

export function weeklySets(program) {
  const m = {};
  for (const d of program.days) for (const e of d.exercises) m[e.muscle] = (m[e.muscle] || 0) + (Number(e.sets) || 0);
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

export function renderProgram(root) {
  const P = state.program;
  const rerender = () => { const y = scrollY; root.innerHTML = ''; renderProgram(root); scrollTo(0, y); };
  const save = () => saveProgram();
  if (!P.days.some(d => d.id === curDay)) curDay = P.days[0]?.id || null;

  root.append(h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Дни, упражнения, подходы'), h('h1', {}, 'Программа')));

  // Недельный объём: план из программы + сделано за текущую неделю (Пн–Вс) по журналу
  const volBox = h('section', { class: 'card' });
  root.append(volBox);
  fillVolume(volBox, P);

  // Вкладки дней
  root.append(h('div', { class: 'chips' },
    P.days.map(d => h('button', { class: 'chip' + (d.id === curDay ? ' on' : ''), onclick: () => { curDay = d.id; openEx = null; rerender(); } }, d.name)),
    h('button', {
      class: 'chip add', onclick: () => {
        const d = { id: uid(), name: 'Новый день', weekdays: [], exercises: [] };
        P.days.push(d); curDay = d.id; save(); rerender();
      },
    }, '+ День')));

  const day = P.days.find(d => d.id === curDay);
  if (day) {
    const di = P.days.indexOf(day);
    root.append(h('section', { class: 'card' },
      h('label', { class: 'field' }, h('span', {}, 'Название дня'),
        h('input', { type: 'text', value: day.name, oninput: e => { day.name = e.target.value; save(); }, onchange: rerender })),
      h('div', { class: 'field' }, h('span', {}, 'Дни недели'),
        h('div', { class: 'wd-pick' }, [1, 2, 3, 4, 5, 6, 0].map(wd => h('button', {
          class: 'wd' + ((day.weekdays || []).includes(wd) ? ' on' : ''), 'aria-pressed': String((day.weekdays || []).includes(wd)),
          onclick: () => {
            day.weekdays = day.weekdays || [];
            day.weekdays = day.weekdays.includes(wd) ? day.weekdays.filter(x => x !== wd) : [...day.weekdays, wd];
            save(); rerender();
          },
        }, WEEKDAYS_SHORT[wd])))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', disabled: di === 0, onclick: () => { P.days.splice(di - 1, 0, P.days.splice(di, 1)[0]); save(); rerender(); } }, '← Раньше'),
        h('button', { class: 'btn small', disabled: di === P.days.length - 1, onclick: () => { P.days.splice(di + 1, 0, P.days.splice(di, 1)[0]); save(); rerender(); } }, 'Позже →'),
        h('button', { class: 'btn small danger', onclick: () => { if (confirm(`Удалить день «${day.name}» из программы? История тренировок сохранится.`)) { P.days.splice(di, 1); save(); rerender(); } } }, 'Удалить день'))));

    const list = h('div', { class: 'prog-list' });
    day.exercises.forEach((ex, i) => list.append(exEditor(day, ex, i, save, rerender)));
    if (!day.exercises.length) list.append(h('div', { class: 'empty small' }, 'Упражнений нет. Добавьте первое.'));
    root.append(list,
      h('button', {
        class: 'btn primary wide', onclick: () => {
          const ex = { id: uid(), name: 'Новое упражнение', muscle: 'Другое', sets: 3, repMin: 8, repMax: 12, rirMin: 2, rirMax: 2, restMin: 120, restMax: 120, failLast: false, warmup: '', ssNext: false };
          day.exercises.push(ex); openEx = ex.id; save(); rerender();
        },
      }, '+ Упражнение'));
  }

  root.append(h('section', { class: 'card danger-zone' },
    h('h2', { class: 'card-h' }, 'Сброс'),
    h('p', { class: 'muted small' }, 'Вернуть программу из research.md. Журнал тренировок не затрагивается.'),
    h('button', { class: 'btn danger', onclick: async () => {
      if (!confirm('Заменить текущую программу программой по умолчанию?')) return;
      state.program = defaultProgram(); await saveProgram(); openEx = null; curDay = null; toast('Программа сброшена'); rerender();
    } }, 'Сбросить к программе по умолчанию')));
}

function exEditor(day, ex, i, save, rerender) {
  const open = openEx === ex.id;
  const partner = ex.ssNext ? day.exercises[i + 1] : null;
  const inSS = i > 0 && day.exercises[i - 1].ssNext;
  const summary = `${ex.kind === 'bw' ? 'свой вес · ' : ''}${ex.sets} × ${range(ex.repMin, ex.repMax)}${ex.kind === 'time' ? ' с' : ''} · RIR ${range(ex.rirMin, ex.rirMax)} · ${restLabel(ex.restMin, ex.restMax)}${ex.failLast ? ' · посл. 0–1' : ''}`;
  const box = h('article', { class: 'pex' + (open ? ' open' : '') + (ex.ssNext ? ' ss-a' : '') + (inSS ? ' ss-b' : '') });

  const n = (key, label, opts = {}) => h('label', { class: 'field' }, h('span', {}, label),
    h('input', {
      type: 'text', inputmode: 'numeric', value: opts.div ? ex[key] / opts.div : ex[key],
      oninput: e => {
        const v = parseFloat(e.target.value.replace(',', '.'));
        if (Number.isFinite(v) && v >= 0) { ex[key] = opts.div ? Math.round(v * opts.div) : Math.round(v); save(); }
      },
      onchange: rerender,
    }));

  box.append(h('button', { class: 'pex-head', 'aria-expanded': String(open), onclick: () => { openEx = open ? null : ex.id; rerender(); } },
    h('span', { class: 'pex-n' }, i + 1),
    h('span', { class: 'pex-t' }, h('b', {}, ex.name), h('small', {}, ex.muscle + ' · ' + summary)),
    partner ? h('span', { class: 'ss-badge' }, 'суперсет ↓') : null));

  if (open) {
    box.append(h('div', { class: 'pex-body' },
      h('label', { class: 'field' }, h('span', {}, 'Название (правка сохраняет историю)'),
        h('input', { type: 'text', value: ex.name, oninput: e => { ex.name = e.target.value; save(); } })),
      h('label', { class: 'field' }, h('span', {}, 'Мышца'),
        h('select', { onchange: e => { ex.muscle = e.target.value; save(); rerender(); } },
          [...new Set([...MUSCLES, ex.muscle])].map(m => h('option', { value: m, selected: m === ex.muscle }, m)))),
      h('label', { class: 'field' }, h('span', {}, 'Тип'),
        h('select', { onchange: e => { ex.kind = e.target.value; save(); rerender(); } },
          KINDS.map(([k, t]) => h('option', { value: k, selected: k === (ex.kind || 'reps') }, t)))),
      h('div', { class: 'grid3' }, n('sets', 'Подходы'), n('repMin', ex.kind === 'time' ? 'Сек от' : 'Повт. от'), n('repMax', ex.kind === 'time' ? 'Сек до' : 'Повт. до')),
      h('div', { class: 'grid3' }, n('rirMin', 'RIR от'), n('rirMax', 'RIR до'), h('span')),
      h('div', { class: 'grid3' }, n('restMin', 'Отдых от, мин', { div: 60 }), n('restMax', 'Отдых до, мин', { div: 60 }), h('span')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ex.failLast, onchange: e => { ex.failLast = e.target.checked; save(); } }), h('span', {}, 'Последний подход можно до отказа (0–1)')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ex.ssNext, disabled: i === day.exercises.length - 1, onchange: e => { ex.ssNext = e.target.checked; save(); rerender(); } }), h('span', {}, 'Суперсет со следующим упражнением')),
      h('label', { class: 'field' }, h('span', {}, 'Разминка (заметка)'),
        h('input', { type: 'text', value: ex.warmup || '', placeholder: 'необязательно', oninput: e => { ex.warmup = e.target.value; save(); } })),
      h('label', { class: 'field' }, h('span', {}, 'Ссылка на технику (видео/фото)'),
        h('input', { type: 'url', inputmode: 'url', value: ex.url || '', placeholder: 'https://…', oninput: e => { const v = e.target.value.trim(); if (!v) delete ex.url; else if (/^https?:\/\//i.test(v)) ex.url = v; save(); } })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', disabled: i === 0, 'aria-label': 'Выше', onclick: () => { move(day, i, -1); save(); rerender(); } }, '↑ Выше'),
        h('button', { class: 'btn small', disabled: i === day.exercises.length - 1, 'aria-label': 'Ниже', onclick: () => { move(day, i, 1); save(); rerender(); } }, '↓ Ниже'),
        h('button', {
          class: 'btn small', onclick: () => {
            const name = prompt('Замена: название нового упражнения. История для него начнётся заново.', '');
            if (!name) return;
            ex.id = uid(); ex.name = name.trim(); openEx = ex.id; save(); rerender(); toast('Упражнение заменено');
          },
        }, '⇄ Заменить'),
        h('button', { class: 'btn small danger', onclick: () => { if (confirm(`Удалить «${ex.name}»?`)) { if (inSS && !ex.ssNext) day.exercises[i - 1].ssNext = false; day.exercises.splice(i, 1); save(); rerender(); } } }, 'Удалить'))));
  }
  return box;
}

function move(day, i, d) {
  const a = day.exercises;
  // Перемещение разрывает пары суперсета, чтобы не склеить случайные упражнения
  if (a[i].ssNext) a[i].ssNext = false;
  if (i > 0 && a[i - 1].ssNext) a[i - 1].ssNext = false;
  const j = i + d;
  if (a[j]?.ssNext) a[j].ssNext = false;
  if (j > 0 && a[j - 1]?.ssNext && j - 1 !== i) a[j - 1].ssNext = false;
  a.splice(j, 0, a.splice(i, 1)[0]);
}

async function fillVolume(box, P) {
  const today = isoDate(), ws = weekStart(today);
  const done = {};
  for (const w of await allWorkouts()) {
    if (w.date < ws || w.date > addDays(ws, 6)) continue;
    for (const e of w.ex) done[e.muscle] = (done[e.muscle] || 0) + e.sets.filter(s => s.done).length;
  }
  const plan = Object.fromEntries(weeklySets(P));
  const keys = [...new Set([...Object.keys(plan), ...Object.keys(done)])].sort((a, b) => (plan[b] || 0) - (plan[a] || 0) || (done[b] || 0) - (done[a] || 0));
  const max = Math.max(1, ...keys.map(k => Math.max(plan[k] || 0, done[k] || 0)));
  box.replaceChildren(
    h('h2', { class: 'card-h' }, 'Прямые подходы в неделю'),
    h('p', { class: 'muted small', style: { marginTop: '-6px' } }, `Сделано / по программе · неделя ${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}`),
    keys.length ? h('div', { class: 'vol' }, keys.map(k => h('div', { class: 'vol-row v2' },
      h('span', {}, k),
      h('div', { class: 'vol-bar v2' },
        h('i', { style: { width: (plan[k] || 0) / max * 100 + '%' } }),
        h('i', { class: 'done', style: { width: Math.min(100, (done[k] || 0) / max * 100) + '%' } })),
      h('b', {}, String(done[k] || 0), h('small', {}, ' / ' + (plan[k] || 0))))))
      : h('p', { class: 'muted' }, 'Нет упражнений'),
    h('p', { class: 'muted small' }, 'План считается по тегу мышцы из программы, «сделано» — по отмеченным подходам в журнале (включая разовые упражнения). Косвенный объём не учитывается.'));
}
