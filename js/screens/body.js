// Тело: ежедневные метрики, талия, фото, графики.
import { h, isoDate, addDays, fmtDate, fmtNum, num, uid, weekStart, toast, e1rm, fmtDateFull } from '../util.js';
import { all, get, put, del } from '../db.js';
import { allWorkouts } from '../state.js';
import { lineChart, rolling7 } from '../charts.js';
import { compressImage } from '../photos.js';

let entryDate = null;
let chartTab = 'weight';
let chartEx = null;
let exMetric = 'e1rm';
let compareSel = [];

export async function renderBody(root, sub = 'log') {
  root.append(h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Вес · шаги · сон · талия · фото'), h('h1', {}, 'Тело')),
    h('div', { class: 'seg' }, [['log', 'Ввод'], ['charts', 'Графики'], ['photos', 'Фото']].map(([k, t]) =>
      h('a', { href: '#body/' + k, class: sub === k ? 'on' : '' }, t))));
  if (sub === 'charts') return renderCharts(root);
  if (sub === 'photos') return renderPhotos(root);
  return renderLog(root);
}

async function renderLog(root) {
  const today = isoDate();
  entryDate = entryDate || today;
  const rec = (await get('metrics', entryDate)) || { date: entryDate };
  const save = async () => { await put('metrics', rec); status.textContent = 'Сохранено'; };
  const status = h('span', { class: 'save-status inline', 'aria-live': 'polite' });
  const go = d => { entryDate = d; root.innerHTML = ''; renderBody(root, 'log'); };

  const fld = (key, label, unit, mode, hint) => h('label', { class: 'metric' },
    h('span', { class: 'metric-l' }, label, hint ? h('small', {}, hint) : null),
    h('span', { class: 'metric-in' },
      h('input', {
        type: 'text', inputmode: mode, enterkeyhint: 'next', value: rec[key] == null ? '' : fmtNum(rec[key], 2), placeholder: '—', autocomplete: 'off',
        oninput: e => { const v = num(e.target.value); if (v == null) delete rec[key]; else rec[key] = v; save(); },
      }),
      h('span', { class: 'unit' }, unit)));

  root.append(h('div', { class: 'date-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Предыдущий день', onclick: () => go(addDays(entryDate, -1)) }, '‹'),
    h('label', { class: 'date-mid' }, h('b', {}, entryDate === today ? 'Сегодня' : fmtDate(entryDate, true)),
      h('input', { type: 'date', value: entryDate, max: today, 'aria-label': 'Дата', onchange: e => e.target.value && go(e.target.value) })),
    h('button', { class: 'icon-btn', 'aria-label': 'Следующий день', disabled: entryDate >= today, onclick: () => go(addDays(entryDate, 1)) }, '›')),
  h('section', { class: 'card metrics' },
    h('div', { class: 'card-h row' }, 'Ежедневно', status),
    fld('weight', 'Вес утром', 'кг', 'decimal', 'после туалета'),
    fld('steps', 'Шаги', 'шаг.', 'numeric'),
    fld('sleep', 'Сон', 'ч', 'decimal'),
    h('div', { class: 'card-h' }, 'Раз в неделю'),
    fld('waist', 'Талия', 'см', 'decimal')));

  // Средние по неделям
  const ms = (await all('metrics')).sort((a, b) => a.date.localeCompare(b.date));
  if (!ms.length) {
    root.append(h('div', { class: 'empty small' }, 'Здесь появятся недельные средние, когда накопятся записи.'));
    return;
  }
  const weeks = weeklyAverages(ms).reverse().slice(0, 12);
  root.append(h('section', { class: 'card' },
    h('h2', { class: 'card-h' }, 'Средние за неделю'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Неделя', 'Вес', 'Шаги', 'Сон', 'Талия'].map(t => h('th', {}, t)))),
      h('tbody', {}, weeks.map(w => h('tr', {},
        h('td', {}, fmtDate(w.week)),
        h('td', {}, fmtNum(w.weight, 2)),
        h('td', {}, fmtNum(w.steps, 0)),
        h('td', {}, fmtNum(w.sleep, 1)),
        h('td', {}, fmtNum(w.waist, 1)))))))));
}

export function weeklyAverages(ms) {
  const map = new Map();
  for (const m of ms) {
    const k = weekStart(m.date);
    if (!map.has(k)) map.set(k, { week: k, _: { weight: [], steps: [], sleep: [], waist: [] } });
    const o = map.get(k)._;
    for (const f of ['weight', 'steps', 'sleep', 'waist']) if (m[f] != null) o[f].push(m[f]);
  }
  return [...map.values()].sort((a, b) => a.week.localeCompare(b.week)).map(w => {
    const r = { week: w.week };
    for (const f of ['weight', 'steps', 'sleep', 'waist']) r[f] = w._[f].length ? w._[f].reduce((a, b) => a + b, 0) / w._[f].length : null;
    return r;
  });
}

async function renderCharts(root) {
  const ms = (await all('metrics')).sort((a, b) => a.date.localeCompare(b.date));
  const tabs = [['weight', 'Вес'], ['wweek', 'Вес / нед'], ['waist', 'Талия'], ['steps', 'Шаги'], ['sleep', 'Сон'], ['ex', 'Упражнения']];
  const box = h('div', { class: 'chart-box' });
  const caption = h('div', { class: 'legend' });
  const extra = h('div');
  root.append(h('div', { class: 'chips scroll' }, tabs.map(([k, t]) => h('button', { class: 'chip' + (k === chartTab ? ' on' : ''), onclick: () => { chartTab = k; root.innerHTML = ''; renderBody(root, 'charts'); } }, t))),
    extra, h('section', { class: 'card' }, caption, box));

  const pts = f => ms.filter(m => m[f] != null).map(m => ({ x: m.date, y: m[f] }));
  const draw = async () => {
    if (chartTab === 'weight') {
      const p = pts('weight');
      caption.replaceChildren(key('dot', 'вес за день'), key('line', 'среднее за 7 дней'));
      lineChart(box, { series: [{ points: p, kind: 'dots', cls: 'soft', name: 'вес' }, { points: rolling7(p), kind: 'line', cls: 'accent', name: 'ср. 7 дн' }], yFmt: v => fmtNum(v, 1), unit: 'кг' });
    } else if (chartTab === 'wweek') {
      const w = weeklyAverages(ms).filter(x => x.weight != null).map(x => ({ x: x.week, y: x.weight, note: 'неделя с ' + fmtDate(x.week) }));
      caption.replaceChildren(key('line', 'средний вес за неделю'));
      lineChart(box, { series: [{ points: w, kind: 'line', dots: true, cls: 'accent' }], yFmt: v => fmtNum(v, 1), unit: 'кг' });
    } else if (chartTab === 'waist') {
      caption.replaceChildren(key('line', 'талия'));
      lineChart(box, { series: [{ points: pts('waist'), kind: 'line', dots: true, cls: 'accent' }], yFmt: v => fmtNum(v, 1), unit: 'см' });
    } else if (chartTab === 'steps') {
      const p = pts('steps');
      caption.replaceChildren(key('bar', 'шаги за день'), key('line', 'среднее за 7 дней'));
      lineChart(box, { series: [{ points: p, kind: 'bars', cls: 'soft', name: 'шаги' }, { points: rolling7(p), kind: 'line', cls: 'accent', name: 'ср. 7 дн' }], yFmt: v => fmtNum(v, 0) });
    } else if (chartTab === 'sleep') {
      const p = pts('sleep');
      caption.replaceChildren(key('bar', 'сон, часы'), key('line', 'среднее за 7 дней'));
      lineChart(box, { series: [{ points: p, kind: 'bars', cls: 'soft', name: 'сон' }, { points: rolling7(p), kind: 'line', cls: 'accent', name: 'ср. 7 дн' }], yFmt: v => fmtNum(v, 1), unit: 'ч' });
    } else if (chartTab === 'ex') {
      await exChart(box, caption, extra);
    }
  };
  requestAnimationFrame(draw);
}

function key(kind, text) { return h('span', { class: 'key ' + kind }, h('i'), text); }

async function exChart(box, caption, extra) {
  const ws = (await allWorkouts()).slice().reverse();
  const names = new Map();
  for (const w of ws) for (const e of w.ex) if (e.sets.some(s => s.done && s.w != null && s.reps)) names.set(e.id, e.name);
  if (!names.size) { box.replaceChildren(h('div', { class: 'chart-empty' }, 'Отметьте выполненные подходы с весом и повторениями — здесь появится прогресс.')); return; }
  if (!names.has(chartEx)) chartEx = [...names.keys()][0];
  extra.replaceChildren(h('section', { class: 'card tight' },
    h('label', { class: 'field' }, h('span', {}, 'Упражнение'),
      h('select', { onchange: e => { chartEx = e.target.value; exChart(box, caption, extra); } },
        [...names].map(([id, n]) => h('option', { value: id, selected: id === chartEx }, n)))),
    h('div', { class: 'seg small' }, [['e1rm', 'Лучший подход'], ['vol', 'Объём']].map(([k, t]) =>
      h('button', { class: exMetric === k ? 'on' : '', onclick: () => { exMetric = k; exChart(box, caption, extra); } }, t)))));
  const pts = [];
  for (const w of ws) {
    const e = w.ex.find(x => x.id === chartEx); if (!e) continue;
    const done = e.sets.filter(s => s.done && s.w != null && s.reps);
    if (!done.length) continue;
    if (exMetric === 'e1rm') {
      const b = done.reduce((a, s) => (e1rm(s.w, s.reps) > e1rm(a.w, a.reps) ? s : a));
      pts.push({ x: w.date, y: e1rm(b.w, b.reps), note: `${fmtNum(b.w, 2)}×${b.reps}` });
    } else pts.push({ x: w.date, y: done.reduce((a, s) => a + s.w * s.reps, 0), note: `${done.length} подх.` });
  }
  caption.replaceChildren(key('line', exMetric === 'e1rm' ? 'лучший подход — оценка 1ПМ по Эпли, кг' : 'объём: сумма вес × повторения, кг'));
  lineChart(box, { series: [{ points: pts, kind: 'line', dots: true, cls: 'accent' }], yFmt: v => fmtNum(v, exMetric === 'e1rm' ? 1 : 0), unit: 'кг' });
}

async function renderPhotos(root) {
  const photos = (await all('photos')).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  compareSel = compareSel.filter(id => photos.some(p => p.id === id));
  const reload = () => { root.innerHTML = ''; renderBody(root, 'photos'); };
  const dateIn = h('input', { type: 'date', value: isoDate(), max: isoDate(), 'aria-label': 'Дата фото' });
  const fileIn = h('input', {
    type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', id: 'ph-in',
    onchange: async e => {
      const files = [...e.target.files]; if (!files.length) return;
      toast('Сжимаю фото…');
      for (const f of files) {
        try { const blob = await compressImage(f); await put('photos', { id: uid(), date: dateIn.value || isoDate(), blob }); }
        catch { toast('Не удалось обработать фото'); }
      }
      toast('Фото сохранено'); reload();
    },
  });
  const last = photos[0];
  root.append(h('section', { class: 'card' },
    h('p', { class: 'muted small' }, 'Раз в ~2 недели. Одинаковый свет, поза и расстояние. Фото сжимаются до 1080 px и хранятся только на этом устройстве (и в экспорте).',
      last ? ` Последнее: ${fmtDateFull(last.date)}.` : ''),
    h('div', { class: 'row-form' }, h('label', { class: 'field' }, h('span', {}, 'Дата'), dateIn),
      h('label', { class: 'btn primary', for: 'ph-in' }, '📷 Добавить фото'), fileIn)));

  if (!photos.length) { root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, '◐'), h('h2', {}, 'Фото пока нет'), h('p', {}, 'Сделайте первое — через пару недель будет с чем сравнить.'))); return; }

  // Сравнение
  const cmp = compareSel.map(id => photos.find(p => p.id === id)).sort((a, b) => a.date.localeCompare(b.date));
  if (cmp.length === 2) {
    const urls = cmp.map(p => URL.createObjectURL(p.blob));
    root.append(h('section', { class: 'compare' },
      cmp.map((p, i) => h('figure', {}, h('img', { src: urls[i], alt: 'Фото ' + fmtDate(p.date) }), h('figcaption', {}, fmtDateFull(p.date)))),
      h('button', { class: 'btn small ghost', onclick: () => { compareSel = []; reload(); } }, 'Закрыть сравнение')));
  } else {
    root.append(h('p', { class: 'hint' }, compareSel.length ? 'Выберите ещё одно фото для сравнения' : 'Нажмите на два фото, чтобы сравнить рядом'));
  }

  const grid = h('div', { class: 'photo-grid' });
  for (const p of photos) {
    const url = URL.createObjectURL(p.blob);
    const sel = compareSel.includes(p.id);
    grid.append(h('div', { class: 'ph' + (sel ? ' sel' : '') },
      h('button', {
        class: 'ph-img', 'aria-pressed': String(sel), 'aria-label': 'Выбрать для сравнения, ' + fmtDate(p.date),
        onclick: () => { compareSel = sel ? compareSel.filter(x => x !== p.id) : [...compareSel, p.id].slice(-2); reload(); },
      }, h('img', { src: url, alt: '', loading: 'lazy' })),
      h('div', { class: 'ph-bar' }, h('span', {}, fmtDate(p.date)),
        h('button', { class: 'ph-del', 'aria-label': 'Удалить фото', onclick: async () => { if (confirm('Удалить это фото?')) { await del('photos', p.id); reload(); } } }, '✕'))));
  }
  root.append(grid);
}
