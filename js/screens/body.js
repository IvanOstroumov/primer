// Тело: ежедневные метрики, талия, фото, графики.
import { h, isoDate, addDays, fmtDate, fmtNum, num, uid, weekStart, toast, e1rm, fmtDateFull } from '../util.js';
import { all, get, put, del } from '../db.js';
import { allWorkouts, state } from '../state.js';
import { lineChart, rolling7 } from '../charts.js';
import { compressImage } from '../photos.js';
import { kindOf, loadBwAt, scoreOf, volumeOf, setText } from '../load.js';

let entryDate = null;
let chartTab = 'weight';
let chartEx = null;
let exMetric = 'e1rm';
let chartEx2 = '';
let chartPeriod = '4w';
const PERIODS = [['4w', '4 нед', 28], ['3m', '3 мес', 91], ['all', 'Всё', null]];
const cutoff = () => { const d = PERIODS.find(p => p[0] === chartPeriod)[2]; return d ? addDays(isoDate(), -d + 1) : '0000'; };
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
  const cut = cutoff();
  const msAll = (await all('metrics')).sort((a, b) => a.date.localeCompare(b.date));
  const ms = msAll.filter(m => m.date >= cut);
  const g = state.settings.goals;
  const tabs = [['weight', 'Вес'], ['wweek', 'Вес / нед'], ['waist', 'Талия'], ['steps', 'Шаги'], ['sleep', 'Сон'], ['ex', 'Упражнения']];
  const box = h('div', { class: 'chart-box' });
  const caption = h('div', { class: 'legend' });
  const extra = h('div');
  root.append(h('div', { class: 'chips scroll' }, tabs.map(([k, t]) => h('button', { class: 'chip' + (k === chartTab ? ' on' : ''), onclick: () => { chartTab = k; root.innerHTML = ''; renderBody(root, 'charts'); } }, t))),
    h('div', { class: 'seg small period' }, PERIODS.map(([k, t]) => h('button', { class: k === chartPeriod ? 'on' : '', 'aria-pressed': String(k === chartPeriod), onclick: () => { chartPeriod = k; root.innerHTML = ''; renderBody(root, 'charts'); } }, t))),
    extra, h('section', { class: 'card' }, caption, box));

  const pts = f => ms.filter(m => m[f] != null).map(m => ({ x: m.date, y: m[f] }));
  // Среднее за 7 дней считаем по всем данным, чтобы начало периода не искажалось
  const r7 = f => rolling7(msAll.filter(m => m[f] != null).map(m => ({ x: m.date, y: m[f] }))).filter(q => q.x >= cut);
  const draw = async () => {
    if (chartTab === 'weight') {
      const F = 'weight', p = pts(F);
      caption.replaceChildren(key('dot', 'вес за день'), key('line', 'среднее за 7 дней'));
      lineChart(box, { series: [{ points: p, kind: 'dots', cls: 'soft', name: 'вес' }, { points: r7(F), kind: 'line', cls: 'accent', name: 'ср. 7 дн' }], yFmt: v => fmtNum(v, 1), unit: 'кг' });
    } else if (chartTab === 'wweek') {
      const w = weeklyAverages(msAll).filter(x => x.week >= weekStart(cut)).filter(x => x.weight != null).map(x => ({ x: x.week, y: x.weight, note: 'неделя с ' + fmtDate(x.week) }));
      caption.replaceChildren(key('line', 'средний вес за неделю'));
      lineChart(box, { series: [{ points: w, kind: 'line', dots: true, cls: 'accent' }], yFmt: v => fmtNum(v, 1), unit: 'кг' });
    } else if (chartTab === 'waist') {
      caption.replaceChildren(key('line', 'талия'));
      lineChart(box, { series: [{ points: pts('waist'), kind: 'line', dots: true, cls: 'accent' }], yFmt: v => fmtNum(v, 1), unit: 'см' });
    } else if (chartTab === 'steps') {
      const F = 'steps', p = pts(F);
      caption.replaceChildren(key('bar', 'шаги за день'), key('line', 'среднее за 7 дней'), key('band', `цель ${fmtNum(g.stepsLo, 0)}–${fmtNum(g.stepsHi, 0)}`));
      lineChart(box, { series: [{ points: p, kind: 'bars', cls: 'soft', name: 'шаги' }, { points: r7(F), kind: 'line', cls: 'accent', name: 'ср. 7 дн' }], yFmt: v => fmtNum(v, 0), band: { lo: g.stepsLo, hi: g.stepsHi } });
    } else if (chartTab === 'sleep') {
      const F = 'sleep', p = pts(F);
      caption.replaceChildren(key('bar', 'сон, часы'), key('line', 'среднее за 7 дней'), key('band', `цель ${fmtNum(g.sleepLo, 1)}–${fmtNum(g.sleepHi, 1)} ч`));
      lineChart(box, { series: [{ points: p, kind: 'bars', cls: 'soft', name: 'сон' }, { points: r7(F), kind: 'line', cls: 'accent', name: 'ср. 7 дн' }], yFmt: v => fmtNum(v, 1), unit: 'ч', band: { lo: g.sleepLo, hi: g.sleepHi } });
    } else if (chartTab === 'ex') {
      await exChart(box, caption, extra, cut);
    }
  };
  requestAnimationFrame(draw);
}

function key(kind, text) { return h('span', { class: 'key ' + kind }, h('i'), text); }

async function exChart(box, caption, extra, cut) {
  const ws = (await allWorkouts()).slice().reverse();
  const bwAt = await loadBwAt();
  const names = new Map(), kinds = new Map();
  for (const w of ws) for (const e of w.ex) if (e.sets.some(s => s.done && s.reps && (s.w != null || kindOf(e) !== 'reps'))) { names.set(e.id, e.name); kinds.set(e.id, kindOf(e)); }
  const isTime = id => kinds.get(id) === 'time';
  if (!names.size) { box.replaceChildren(h('div', { class: 'chart-empty' }, 'Отметьте выполненные подходы с весом и повторениями — здесь появится прогресс.')); return; }
  if (!names.has(chartEx)) chartEx = [...names.keys()][0];
  // Сравнивать можно только упражнения с той же единицей (кг или секунды)
  if (chartEx2 && (!names.has(chartEx2) || chartEx2 === chartEx || isTime(chartEx2) !== isTime(chartEx))) chartEx2 = '';
  const T = isTime(chartEx);
  const again = () => exChart(box, caption, extra, cut);
  extra.replaceChildren(h('section', { class: 'card tight' },
    h('label', { class: 'field' }, h('span', {}, 'Упражнение'),
      h('select', { onchange: e => { chartEx = e.target.value; again(); } },
        [...names].map(([id, n]) => h('option', { value: id, selected: id === chartEx }, n)))),
    h('label', { class: 'field' }, h('span', {}, 'Сравнить с (пунктир)'),
      h('select', { onchange: e => { chartEx2 = e.target.value; again(); } },
        h('option', { value: '' }, '— нет —'),
        [...names].filter(([id]) => id !== chartEx && isTime(id) === T).map(([id, n]) => h('option', { value: id, selected: id === chartEx2 }, n)))),
    h('div', { class: 'seg small' }, [['e1rm', T ? 'Лучшее время' : 'Лучший подход'], ['vol', T ? 'Сумма секунд' : 'Объём']].map(([k, t]) =>
      h('button', { class: exMetric === k ? 'on' : '', onclick: () => { exMetric = k; again(); } }, t)))));
  const series = (id) => {
    const pts = [];
    for (const w of ws) {
      if (w.date < cut) continue;
      const e = w.ex.find(x => x.id === id); if (!e) continue;
      const done = e.sets.filter(s => s.done && s.reps && (s.w != null || kindOf(e) !== 'reps'));
      if (!done.length) continue;
      if (exMetric === 'e1rm') {
        const sc = s => scoreOf(e, s, bwAt, w.date);
        const b = done.reduce((a, s) => (sc(s) > sc(a) ? s : a));
        pts.push({ x: w.date, y: sc(b), note: setText(e, b, false) });
      } else pts.push({ x: w.date, y: volumeOf(e, done, bwAt, w.date), note: `${done.length} подх.` });
    }
    return pts;
  };
  const what = T
    ? (exMetric === 'e1rm' ? 'лучшее время, с' : 'сумма секунд за тренировку')
    : (exMetric === 'e1rm' ? 'лучший подход — оценка 1ПМ по Эпли, кг' : 'объём: сумма нагрузка × повторения, кг');
  const list = [{ points: series(chartEx), kind: 'line', dots: true, cls: 'accent', name: names.get(chartEx) }];
  const keys = [key('line', chartEx2 ? names.get(chartEx) : what)];
  if (chartEx2) {
    list.push({ points: series(chartEx2), kind: 'line', dots: true, cls: 'alt', name: names.get(chartEx2) });
    keys.push(key('line alt', names.get(chartEx2)), h('span', { class: 'muted' }, what));
  }
  caption.replaceChildren(...keys);
  if (kinds.get(chartEx) === 'bw' || kinds.get(chartEx2) === 'bw') keys.push(h('span', { class: 'muted' }, 'свой вес: нагрузка = вес тела на дату + добавочный'));
  keys.push(h('a', { class: 'ex-open', href: '#ex/' + encodeURIComponent(chartEx) }, 'Страница упражнения ›'));
  caption.replaceChildren(...keys);
  lineChart(box, { series: list, yFmt: v => fmtNum(v, exMetric === 'e1rm' && !T ? 1 : 0), unit: T ? 'с' : 'кг' });
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
