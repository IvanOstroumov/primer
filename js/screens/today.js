// Сегодня / логгер тренировки, история, редактирование прошлой тренировки.
import { h, isoDate, fmtDate, fmtNum, num, uid, range, restLabel, toast, undoToast, fmtDuration, fmtRest, parseDate, plural, weekStart, addDays, WEEKDAYS_SHORT } from '../util.js';
import { put, del, get, all } from '../db.js';
import { state, allWorkouts, lastSessionFor, workoutDuration } from '../state.js';
import { kindOf, loadBwAt, prSets, prCount, setText, volumeOf } from '../load.js';
import { startTimer } from '../timer.js';
import { rampInfo } from './ramp.js';

const SKIP = ['занято', 'боль', 'нет времени', 'другое'];

// День по умолчанию: по расписанию сегодня, иначе ближайший следующий
export function defaultDayId(date = new Date()) {
  const days = state.program.days;
  for (let i = 0; i < 7; i++) {
    const wd = (date.getDay() + i) % 7;
    const d = days.find(x => (x.weekdays || []).includes(wd));
    if (d) return d.id;
  }
  return days[0]?.id;
}

function snapshot(ex, workouts) {
  const last = lastSessionFor(workouts, ex.id, null, null);
  const sets = Array.from({ length: ex.sets }, (_, i) => {
    const p = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null;
    return { w: p ? p.w : null, reps: p ? p.reps : null, rir: p ? p.rir : null, done: false };
  });
  const { sets: _n, ...rest } = ex;
  return { ...rest, target: ex.sets, sets };
}

export async function renderToday(root, dayIdArg) {
  const today = isoDate();
  const workouts = await allWorkouts();
  const days = state.program.days;
  if (!days.length) {
    root.append(h('div', { class: 'empty' }, h('h2', {}, 'Программа пуста'), h('p', {}, 'Обратитесь к разработчику.')));
    return;
  }
  const dayId = days.some(d => d.id === dayIdArg) ? dayIdArg : defaultDayId();
  const day = days.find(d => d.id === dayId);
  let w = workouts.find(x => x.date === today && x.dayId === dayId);
  const isDraft = !w;
  if (!w) {
    w = { id: uid(), date: today, created: new Date().toISOString(), dayId, dayName: day.name, ex: day.exercises.map(ex => snapshot(ex, workouts)) };
  }

  const wd = parseDate(today).getDay();
  const scheduled = days.find(d => (d.weekdays || []).includes(wd));
  root.append(
    h('header', { class: 'page-head' },
      h('div', { class: 'eyebrow' }, fmtDate(today, true) + (scheduled ? '' : ' · по расписанию отдых')),
      h('h1', {}, day.name),
      h('a', { class: 'head-link', href: '#history' }, 'История')),
    h('div', { class: 'chips', role: 'tablist' },
      days.map(d => h('a', {
        class: 'chip' + (d.id === dayId ? ' on' : ''), href: '#today/' + d.id, role: 'tab', 'aria-selected': String(d.id === dayId),
      }, d.name, (d.weekdays || []).length ? h('small', {}, d.weekdays.map(x => WEEKDAYS_SHORT[x]).join(' ')) : null))),
  );
  const ramp = rampInfo(today);
  if (ramp && ramp.week >= 1 && ramp.week <= 4) {
    root.append(h('a', { class: 'ramp-strip', href: '#ramp' },
      h('b', {}, `Возврат · неделя ${ramp.week}`), ` Подходы: ${ramp.row.sets} · RIR ${ramp.row.rir}`));
  }
  root.append(workoutEditor(w, isDraft, workouts, await loadBwAt(), true));
}

export async function renderWorkout(root, id) {
  const w = await get('workouts', id);
  if (!w) { root.append(h('div', { class: 'empty' }, h('h2', {}, 'Тренировка не найдена'), h('a', { class: 'btn', href: '#history' }, 'К истории'))); return; }
  const workouts = await allWorkouts();
  const bwAt = await loadBwAt();
  root.append(
    h('header', { class: 'page-head' },
      h('div', { class: 'eyebrow' }, h('a', { href: '#history' }, '← История')),
      h('h1', {}, w.dayName)),
    h('div', { class: 'row-form' },
      h('label', { class: 'field' }, h('span', {}, 'Дата'),
        h('input', { type: 'date', value: w.date, onchange: async e => { if (e.target.value) { w.date = e.target.value; await put('workouts', w); toast('Дата сохранена'); } } })),
      h('button', {
        class: 'btn danger', onclick: async () => {
          if (!confirm('Удалить эту тренировку целиком?')) return;
          await del('workouts', w.id); location.hash = '#history';
        },
      }, 'Удалить тренировку')),
    workoutEditor(w, false, workouts, bwAt));
}

function workoutEditor(w, isDraft, workouts, bwAt, showFinish) {
  let saved = !isDraft;
  const status = h('div', { class: 'save-status', 'aria-live': 'polite' });
  const clock = h('div', { class: 'live-clock', hidden: true });
  let statusText = saved ? 'Сохранено' : 'Черновик: сохранится при первом вводе';
  // Секундомер: от первого отмеченного подхода; только для сегодняшней тренировки
  const firstAt = () => {
    const ts = w.ex.flatMap(e => e.sets.filter(s => s.done && s.at).map(s => Date.parse(s.at))).filter(Number.isFinite);
    return ts.length ? Math.min(...ts) : null;
  };
  const isLive = () => w.date === isoDate() && firstAt() != null;
  const showStatus = () => {
    const d = workoutDuration(w);
    status.textContent = [statusText, d != null && !isLive() ? '⏱ ' + fmtDuration(d) : ''].filter(Boolean).join(' · ');
  };
  const tickClock = () => {
    if (!clock.isConnected && clock._started) { clearInterval(clock._iv); return; }
    const f = firstAt();
    if (!isLive()) { clock.hidden = true; return; }
    clock.hidden = false;
    const sec = Math.max(0, Math.floor((Date.now() - f) / 1000));
    clock.replaceChildren(h('span', {}, 'идёт'), h('b', {}, sec >= 3600 ? `${Math.floor(sec / 3600)}:${fmtRest(sec % 3600).padStart(5, '0')}` : fmtRest(sec)));
  };
  clock._iv = setInterval(tickClock, 1000);
  setTimeout(() => { clock._started = true; }, 0);

  const save = async () => {
    w.updated = new Date().toISOString();
    await put('workouts', w);
    saved = true;
    statusText = 'Сохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    showStatus(); tickClock();
  };
  showStatus(); tickClock();

  const wrap = h('div', { class: 'workout' });
  const draw = () => {
    wrap.innerHTML = '';
    const list = w.ex;
    const ctx = { w, workouts, save, redraw: draw, bwAt };
    for (let i = 0; i < list.length; i++) {
      const ex = list[i];
      if (ex.ssNext && list[i + 1]) {
        wrap.append(h('section', { class: 'superset' },
          h('div', { class: 'ss-label' }, 'Суперсет · ', restLabel(list[i + 1].restMin, list[i + 1].restMax), ' между кругами'),
          exCard(ex, ctx, 'A'),
          exCard(list[i + 1], ctx, 'Б')));
        i++;
      } else wrap.append(exCard(ex, ctx, null));
    }
    if (!list.length) wrap.append(h('div', { class: 'empty small' }, 'В этой тренировке нет упражнений.'));
    wrap.append(
      h('label', { class: 'field wnote' }, h('span', {}, 'Заметка к тренировке'),
        h('textarea', { rows: 2, placeholder: 'самочувствие, сон, что угодно', value: w.note || '', oninput: e => { w.note = e.target.value; save(); } })),
      showFinish ? h('button', {
        class: 'btn primary wide finish-btn',
        onclick: async () => {
          w.finishedAt = new Date().toISOString();
          await save();
          toast('Тренировка завершена 💪');
          location.hash = '#history';
        },
      }, '✓ Завершить тренировку') : null,
    );
  };
  draw();
  return h('div', {}, h('div', { class: 'status-row' }, clock, status), wrap);
}

// Разница с тем же подходом прошлой тренировки — только факт
function diffText(ex, cur, prev) {
  if (!prev) return null;
  const parts = [];
  const dr = (cur.reps ?? 0) - (prev.reps ?? 0);
  const dw = (cur.w ?? 0) - (prev.w ?? 0);
  if (dr) parts.push(`${dr > 0 ? '+' : '−'}${Math.abs(dr)} ${kindOf(ex) === 'time' ? 'с' : 'повт'}`);
  if (Math.abs(dw) > 1e-9) parts.push(`${dw > 0 ? '+' : '−'}${fmtNum(Math.abs(dw), 2)} кг`);
  return parts.length ? parts.join(' · ') : 'как в прошлый раз';
}

function exCard(ex, ctx, ssTag) {
  const { w, workouts, save, redraw, bwAt } = ctx;
  const k = kindOf(ex);
  const last = lastSessionFor(workouts, ex.id, w.id, w.date);
  let editing = false;
  const rows = h('div', { class: 'sets' });
  const card = h('article', { class: 'ex' + (ssTag ? ' in-ss' : '') + (ex.skipped ? ' skipped' : '') });

  const counter = h('span', { class: 'ex-count' });
  const titleRow = h('div', { class: 'ex-head' },
    ssTag ? h('span', { class: 'ss-tag' }, ssTag) : null,
    h('div', { class: 'ex-title' },
      h('h3', {}, h('a', { href: '#ex/' + encodeURIComponent(ex.id), class: 'ex-link' }, ex.name),
        ex.url ? h('a', { class: 'tech-link', href: ex.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Техника: открыть ссылку' }, '▶') : null),
      h('div', { class: 'ex-meta' },
        k === 'bw' ? h('span', { class: 'extra-tag' }, 'свой вес') : null,
        `${ex.target ?? ex.sets.length} × ${range(ex.repMin, ex.repMax)}${k === 'time' ? ' с' : ''} · RIR ${range(ex.rirMin, ex.rirMax)}`, ' · ', h('span', { class: 'muscle' }, ex.muscle))),
    ex.skipped ? null : counter);

  if (ex.skipped) {
    card.append(titleRow,
      h('div', { class: 'skip-box' },
        h('span', {}, 'Пропущено: ', h('b', {}, ex.skipped.reason === 'другое' && ex.skipped.text ? ex.skipped.text : ex.skipped.reason)),
        h('button', { class: 'btn small', onclick: () => { const prev = ex.skipped; ex.skipped = null; save(); redraw(); undoToast('Пропуск снят', () => { ex.skipped = prev; save(); redraw(); }); } }, 'Вернуть')));
    return card;
  }

  const restBtn = h('button', {
    class: 'rest-btn', onclick: () => startTimer(ex.restMin, ex.name),
    'aria-label': 'Запустить таймер отдыха',
  }, '⏱ ', restLabel(ex.restMin, ex.restMax));

  const doneCount = () => ex.sets.filter(s => s.done).length;
  const upd = () => { counter.textContent = `${doneCount()}/${ex.sets.length}`; card.classList.toggle('complete', ex.sets.length > 0 && doneCount() === ex.sets.length); };

  const drawRows = () => {
    rows.innerHTML = '';
    const prs = prSets(workouts, w, ex, bwAt);
    ex.sets.forEach((st, idx) => rows.append(setRow(st, idx, prs.get(idx))));
    upd();
  };

  const wFmt = v => (k === 'bw' && v > 0 ? '+' : '') + fmtNum(v, 2);
  const setRow = (st, idx, pr) => {
    const isLast = idx === ex.sets.length - 1;
    const row = h('div', { class: 'set' + (st.done ? ' done' : '') });
    const field = (key, label, step, min, dec) => {
      const inp = h('input', {
        type: 'text', inputmode: dec ? 'decimal' : 'numeric', enterkeyhint: 'done', autocomplete: 'off',
        value: st[key] == null ? '' : (key === 'w' ? wFmt(st[key]) : fmtNum(st[key], 2)), 'aria-label': `${label}, подход ${idx + 1}`, placeholder: k === 'bw' && key === 'w' ? '0' : '—',
        oninput: () => { st[key] = num(inp.value.replace('+', '')); save(); },
        onchange: () => { if (st.done) drawRows(); },
        onfocus: () => inp.select(),
      });
      const bump = d => {
        const base = st[key] ?? (d > 0 || min < 0 ? 0 : min);
        const v = Math.max(min, Math.round((base + d) * 100) / 100);
        st[key] = v; inp.value = key === 'w' ? wFmt(v) : fmtNum(v, 2); save();
      };
      return h('div', { class: 'cell' },
        h('div', { class: 'cell-lbl' }, label),
        inp,
        h('div', { class: 'steps' },
          h('button', { type: 'button', 'aria-label': `${label} минус`, onclick: () => bump(-step) }, '−'),
          h('button', { type: 'button', 'aria-label': `${label} плюс`, onclick: () => bump(step) }, '+')));
    };
    const doneBtn = h('button', {
      class: 'done-btn', 'aria-pressed': String(!!st.done), 'aria-label': `Подход ${idx + 1} ${st.done ? 'выполнен' : 'отметить выполненным'}`,
      onclick: () => {
        const prev = { done: st.done, at: st.at };
        st.done = !st.done;
        if (st.done) st.at = new Date().toISOString();
        save(); drawRows();
        if (st.done && !ex.ssNext) startTimer(ex.restMin, ex.name);
        if (st.done && ex.ssNext) toast('Теперь упражнение Б');
        undoToast(st.done ? `Подход ${idx + 1} отмечен` : `Отметка подхода ${idx + 1} снята`, () => {
          st.done = prev.done; st.at = prev.at; save(); drawRows();
        });
      },
    }, st.done ? '✓' : String(idx + 1));
    // RIR кнопками 0–5+ (5 хранится как 5 и значит «5+»)
    const rir = h('div', { class: 'rir-chips', role: 'group', 'aria-label': `RIR, подход ${idx + 1}` },
      h('span', { class: 'rir-lbl' }, 'RIR'),
      [0, 1, 2, 3, 4, 5].map(v => {
        const on = v === 5 ? st.rir >= 5 : st.rir === v;
        return h('button', {
          type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on),
          onclick: () => { st.rir = on ? null : v; save(); drawRows(); },
        }, v === 5 ? '5+' : String(v));
      }));
    row.append(
      doneBtn,
      field('w', k === 'bw' ? '± кг' : 'кг', 2.5, k === 'bw' ? -300 : 0, true),
      field('reps', k === 'time' ? 'сек' : 'повт', k === 'time' ? 5 : 1, 0, false),
      rir);
    if (st.done && last) {
      const d = diffText(ex, st, last.sets[idx]);
      if (d) row.append(h('div', { class: 'set-diff' }, 'к прошлому: ', d));
    }
    if (pr) row.append(h('div', { class: 'set-pr' }, `★ рекорд · ${pr}`));
    if (ex.failLast && isLast) row.append(h('div', { class: 'set-note' }, 'последний: можно 0–1'));
    if (editing) row.append(h('button', {
      class: 'del-set', 'aria-label': `Удалить подход ${idx + 1}`,
      onclick: () => {
        const [removed] = ex.sets.splice(idx, 1); save(); drawRows();
        undoToast(`Подход ${idx + 1} удалён`, () => { ex.sets.splice(idx, 0, removed); save(); drawRows(); });
      },
    }, 'Удалить'));
    return row;
  };

  // Заметка к упражнению
  const noteBox = h('div', { class: 'ex-note' });
  const drawNote = focus => {
    if (ex.note == null && !focus) { noteBox.replaceChildren(); return; }
    const inp = h('input', { type: 'text', value: ex.note || '', placeholder: 'сиденье на 4, болело плечо…', 'aria-label': 'Заметка к упражнению', oninput: e => { ex.note = e.target.value; save(); } });
    noteBox.replaceChildren(h('span', {}, '✎'), inp);
    if (focus) inp.focus();
  };

  // Пропуск с причиной
  const skipBox = h('div', { class: 'skip-pick', hidden: true },
    h('span', { class: 'muted small' }, 'Причина:'),
    SKIP.map(r => h('button', {
      class: 'btn small', onclick: () => {
        let text = '';
        if (r === 'другое') { text = (prompt('Причина пропуска', '') || '').trim(); if (!text) return; }
        ex.skipped = { reason: r, text }; save(); redraw();
        undoToast(`«${ex.name}» пропущено`, () => { ex.skipped = null; save(); redraw(); });
      },
    }, r)));

  // «Как в прошлый раз»: только неотмеченные подходы
  const repeatLast = () => {
    const backup = ex.sets.map(s => ({ ...s }));
    let n = 0;
    ex.sets.forEach((s, i) => {
      if (s.done) return;
      const p = last.sets[i] || last.sets[last.sets.length - 1];
      s.w = p.w; s.reps = p.reps; s.rir = p.rir; n++;
    });
    if (!n) { toast('Все подходы уже отмечены'); return; }
    save(); drawRows();
    undoToast('Подставлено как в прошлый раз', () => { ex.sets.forEach((s, i) => Object.assign(s, backup[i])); save(); drawRows(); });
  };

  card.append(...[
    titleRow,
    h('div', { class: 'ex-flags' },
      restBtn,
      ex.failLast ? h('span', { class: 'flag' }, 'последний подход 0–1') : h('span', { class: 'flag muted' }, 'без отказа')),
    ex.warmup ? h('div', { class: 'warm' }, 'Разминка: ', ex.warmup) : null,
    h('div', { class: 'last' }, last
      ? [h('div', { class: 'last-top' }, h('span', { class: 'last-lbl' }, 'Прошлый раз · ' + fmtDate(last.date)),
          h('button', { class: 'repeat-btn', onclick: repeatLast }, '↺ как в прошлый раз')),
        h('span', { class: 'last-sets' }, last.sets.map(s => setText(ex, s)).join('   ')),
        last.note ? h('span', { class: 'last-note' }, '✎ ' + last.note) : null]
      : h('span', { class: 'last-lbl' }, 'Прошлого раза ещё нет')),
    rows,
    noteBox,
    h('div', { class: 'ex-foot' },
      h('button', { class: 'btn small', onclick: () => { const p = ex.sets[ex.sets.length - 1]; ex.sets.push({ w: p?.w ?? null, reps: p?.reps ?? null, rir: p?.rir ?? null, done: false }); save(); drawRows(); } }, '+ Подход'),
      h('button', { class: 'btn small ghost', onclick: e => { editing = !editing; e.target.textContent = editing ? 'Готово' : 'Изменить'; drawRows(); } }, 'Изменить'),
      ex.note == null ? h('button', { class: 'btn small ghost', 'aria-label': 'Добавить заметку', onclick: e => { e.target.remove(); drawNote(true); } }, '✎') : null,
      h('button', { class: 'btn small ghost', 'aria-expanded': 'false', onclick: e => { skipBox.hidden = !skipBox.hidden; e.target.setAttribute('aria-expanded', String(!skipBox.hidden)); } }, 'Пропустить')),
    skipBox,
  ].filter(Boolean));
  drawNote(false);
  drawRows();
  return card;
}

// Календарь месяца: закрашены дни с тренировками, контуром — прошедшие дни по расписанию без тренировки
let calMonth = null;
function calendar(workouts, onChange) {
  const today = isoDate();
  const first = workouts.length ? workouts[workouts.length - 1].date : today;
  if (!calMonth) calMonth = today.slice(0, 7);
  const [y, m] = calMonth.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const offset = (start.getDay() + 6) % 7;
  const byDate = new Map();
  for (const w of workouts) if (!byDate.has(w.date)) byDate.set(w.date, w);
  const sched = new Set(state.program.days.flatMap(d => d.weekdays || []));
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'cal-c blank' }));
  for (let d = 1; d <= days; d++) {
    const iso = isoDate(new Date(y, m - 1, d));
    const wk = byDate.get(iso);
    const missed = !wk && iso < today && iso >= first && sched.has(new Date(y, m - 1, d).getDay());
    const cls = 'cal-c' + (wk ? ' on' : '') + (missed ? ' miss' : '') + (iso === today ? ' today' : '');
    cells.push(wk
      ? h('a', { class: cls, href: '#workout/' + wk.id, 'aria-label': `${fmtDate(iso)}: ${wk.dayName}` }, d)
      : h('span', { class: cls, 'aria-label': missed ? `${fmtDate(iso)}: пропуск по расписанию` : null }, d));
  }
  const shift = n => { const d = new Date(y, m - 1 + n, 1); calMonth = isoDate(d).slice(0, 7); onChange(); };
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const cnt = workouts.filter(w => w.date.startsWith(calMonth)).length;
  return h('section', { class: 'card cal' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => shift(-1) }, '‹'),
      h('div', {}, h('b', {}, `${MONTHS[m - 1]} ${y}`), h('small', {}, `${cnt} ${plural(cnt, 'тренировка', 'тренировки', 'тренировок')}`)),
      h('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => shift(1) }, '›')),
    h('div', { class: 'cal-grid' }, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(t => h('span', { class: 'cal-wd' }, t)), cells),
    h('div', { class: 'legend' }, h('span', { class: 'key cal-on' }, h('i'), 'тренировка'), h('span', { class: 'key cal-miss' }, h('i'), 'пропуск по расписанию')));
}

// Недельная сводка (Пн–Вс)
let sumWeek = null;
function weekSummary(workouts, metrics, bwAt, onChange) {
  const cur = weekStart(isoDate());
  if (!sumWeek) sumWeek = cur;
  const end = addDays(sumWeek, 6);
  const ws = workouts.filter(w => w.date >= sumWeek && w.date <= end);
  const sets = ws.reduce((a, w) => a + w.ex.reduce((b, e) => b + e.sets.filter(s => s.done).length, 0), 0);
  const ton = ws.reduce((a, w) => a + w.ex.filter(e => kindOf(e) !== 'time').reduce((b, e) => b + volumeOf(e, e.sets, bwAt, w.date), 0), 0);
  const ms = metrics.filter(m => m.date >= sumWeek && m.date <= end);
  const avg = f => { const v = ms.filter(m => m[f] != null).map(m => m[f]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const stat = (v, l) => h('div', { class: 'wk-stat' }, h('b', {}, v), h('span', {}, l));
  const shift = n => { sumWeek = addDays(sumWeek, 7 * n); onChange(); };
  return h('section', { class: 'card wk' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Предыдущая неделя', onclick: () => shift(-1) }, '‹'),
      h('div', {}, h('b', {}, sumWeek === cur ? 'Эта неделя' : 'Неделя'), h('small', {}, `${fmtDate(sumWeek)} – ${fmtDate(end)}`)),
      h('button', { class: 'icon-btn', 'aria-label': 'Следующая неделя', disabled: sumWeek >= cur, onclick: () => shift(1) }, '›')),
    h('div', { class: 'wk-grid' },
      stat(String(ws.filter(w => w.ex.some(e => e.sets.some(s => s.done))).length), 'тренировок'),
      stat(String(sets), 'подходов'),
      stat(fmtNum(ton, 0), 'тоннаж, кг'),
      stat(fmtNum(avg('weight'), 1), 'ср. вес, кг'),
      stat(fmtNum(avg('steps'), 0), 'ср. шаги'),
      stat(fmtNum(avg('sleep'), 1), 'ср. сон, ч')));
}

export async function renderHistory(root, tab) {
  const allW = await allWorkouts();
  const bwAt = await loadBwAt();
  const workouts = allW.filter(w => w.ex.some(e => e.sets.some(s => s.done || s.w != null) || e.skipped));
  root.append(h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, h('a', { href: '#today' }, '← Сегодня')), h('h1', {}, 'История')),
    h('div', { class: 'seg' }, [['', 'Тренировки'], ['records', 'Рекорды']].map(([k, t]) => h('a', { href: '#history' + (k ? '/' + k : ''), class: (tab || '') === k ? 'on' : '' }, t))));
  if (!workouts.length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, '0'), h('h2', {}, 'Тренировок пока нет'), h('p', {}, 'Отметьте первый подход на экране «Сегодня», и тренировка появится здесь.'), h('a', { class: 'btn primary', href: '#today' }, 'К тренировке')));
    return;
  }
  if (tab === 'records') { renderRecords(root, allW, bwAt); return; }

  const metrics = await all('metrics');
  const sumBox = h('div'), calBox = h('div');
  const drawSum = () => sumBox.replaceChildren(weekSummary(workouts, metrics, bwAt, drawSum));
  const drawCal = () => calBox.replaceChildren(calendar(workouts, drawCal));
  drawSum(); drawCal();
  const ul = h('div', { class: 'hist' });
  for (const w of workouts) {
    const done = w.ex.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    const vol = w.ex.filter(e => kindOf(e) !== 'time').reduce((a, e) => a + volumeOf(e, e.sets, bwAt, w.date), 0);
    const dur = workoutDuration(w);
    const prs = prCount(allW, w, bwAt);
    const skipped = w.ex.filter(e => e.skipped).length;
    ul.append(h('a', { class: 'hist-item', href: '#workout/' + w.id },
      h('div', { class: 'hist-date' }, h('b', {}, String(parseDate(w.date).getDate())), h('small', {}, fmtDate(w.date).split(' ')[1])),
      h('div', { class: 'hist-body' }, h('div', { class: 'hist-name' }, w.dayName, prs ? h('span', { class: 'pr-chip' }, `★ ${prs}`) : null),
        h('div', { class: 'hist-sub' }, [`${done} ${plural(done, 'подход', 'подхода', 'подходов')}`, `тоннаж ${fmtNum(vol, 0)} кг`, dur != null ? fmtDuration(dur) : null, skipped ? `пропущено ${skipped}` : null].filter(Boolean).join(' · ')),
        w.note ? h('div', { class: 'hist-note' }, '✎ ' + w.note) : null),
      h('span', { class: 'chev' }, '›')));
  }
  root.append(sumBox, calBox, ul);
}

function renderRecords(root, allW, bwAt) {
  const items = [];
  for (const w of allW) for (const e of w.ex) for (const [i, what] of prSets(allW, w, e, bwAt)) items.push({ w, e, s: e.sets[i], i, what });
  if (!items.length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, '★'), h('h2', {}, 'Рекордов пока нет'), h('p', {}, 'Рекорд — подход, который лучше всех прошлых тренировок этого упражнения по весу, оценке 1ПМ или времени.')));
    return;
  }
  root.append(h('div', { class: 'hist' }, items.map(r => h('a', { class: 'hist-item', href: '#workout/' + r.w.id },
    h('div', { class: 'hist-date' }, h('b', {}, String(parseDate(r.w.date).getDate())), h('small', {}, fmtDate(r.w.date).split(' ')[1])),
    h('div', { class: 'hist-body' }, h('div', { class: 'hist-name' }, r.e.name),
      h('div', { class: 'hist-sub' }, `${setText(r.e, r.s, false)} · подход ${r.i + 1} · `, h('b', { class: 'pr-what' }, '★ ' + r.what))),
    h('span', { class: 'chev' }, '›')))));
}
