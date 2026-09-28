// Сегодня / логгер тренировки, история, редактирование прошлой тренировки.
import { h, isoDate, fmtDate, fmtNum, num, uid, range, restLabel, toast, undoToast, fmtDuration, parseDate, plural, WEEKDAYS_SHORT } from '../util.js';
import { put, del, get } from '../db.js';
import { state, allWorkouts, lastSessionFor, workoutDuration, prSets, prCount } from '../state.js';
import { MUSCLES } from '../seed.js';
import { startTimer } from '../timer.js';
import { rampInfo } from './ramp.js';

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
    root.append(h('div', { class: 'empty' }, h('h2', {}, 'В программе нет дней'), h('p', {}, 'Добавьте день в разделе «Программа».'), h('a', { class: 'btn primary', href: '#program' }, 'Открыть программу')));
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
  root.append(workoutEditor(w, isDraft, workouts));
}

export async function renderWorkout(root, id) {
  const w = await get('workouts', id);
  if (!w) { root.append(h('div', { class: 'empty' }, h('h2', {}, 'Тренировка не найдена'), h('a', { class: 'btn', href: '#history' }, 'К истории'))); return; }
  const workouts = await allWorkouts();
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
    workoutEditor(w, false, workouts));
}

function workoutEditor(w, isDraft, workouts) {
  let saved = !isDraft;
  const status = h('div', { class: 'save-status', 'aria-live': 'polite' });
  const showStatus = t => {
    const d = workoutDuration(w);
    status.textContent = [t, d != null ? '⏱ ' + fmtDuration(d) : ''].filter(Boolean).join(' · ');
  };
  const save = async () => {
    w.updated = new Date().toISOString();
    await put('workouts', w);
    saved = true;
    showStatus('Сохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  };
  showStatus(saved ? 'Сохранено' : 'Черновик: сохранится при первом вводе');

  const wrap = h('div', { class: 'workout' });
  const draw = () => {
    wrap.innerHTML = '';
    const list = w.ex;
    const ctx = { w, workouts, save, redraw: draw };
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
    wrap.append(addExercisePanel(w, save, draw),
      h('label', { class: 'field wnote' }, h('span', {}, 'Заметка к тренировке'),
        h('textarea', { rows: 2, placeholder: 'самочувствие, сон, что угодно', value: w.note || '', oninput: e => { w.note = e.target.value; save(); } })));
  };
  draw();
  return h('div', {}, status, wrap);
}

function addExercisePanel(w, save, redraw) {
  const box = h('div', { class: 'add-ex' });
  const closed = () => box.replaceChildren(h('button', { class: 'btn wide', onclick: open }, '+ Упражнение в эту тренировку'));
  function open() {
    const opts = state.program.days.map(d => h('optgroup', { label: d.name }, d.exercises.map(e => h('option', { value: d.id + '|' + e.id }, e.name))));
    const sel = h('select', { 'aria-label': 'Упражнение из программы' }, h('option', { value: '' }, '— из программы —'), opts);
    const name = h('input', { type: 'text', placeholder: 'или новое название', 'aria-label': 'Новое упражнение' });
    const muscle = h('select', { 'aria-label': 'Мышца' }, MUSCLES.map(m => h('option', { value: m, selected: m === 'Другое' }, m)));
    box.replaceChildren(h('section', { class: 'card' },
      h('h2', { class: 'card-h' }, 'Разовое упражнение'),
      h('p', { class: 'muted small' }, 'Добавляется только в эту тренировку, программа не меняется.'),
      h('label', { class: 'field' }, h('span', {}, 'Из программы (история продолжится)'), sel),
      h('label', { class: 'field' }, h('span', {}, 'Новое (отдельная история)'), name),
      h('label', { class: 'field' }, h('span', {}, 'Мышца для нового'), muscle),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn primary', onclick: async () => {
            let ex;
            if (sel.value) {
              const [dId, eId] = sel.value.split('|');
              const src = state.program.days.find(d => d.id === dId).exercises.find(e => e.id === eId);
              ex = snapshot(src, await allWorkouts());
            } else if (name.value.trim()) {
              ex = { id: uid(), name: name.value.trim(), muscle: muscle.value, target: 3, repMin: 8, repMax: 12, rirMin: 2, rirMax: 2, restMin: 120, restMax: 120, failLast: false, warmup: '', sets: [0, 1, 2].map(() => ({ w: null, reps: null, rir: null, done: false })) };
            } else { toast('Выберите упражнение или введите название'); return; }
            ex.ssNext = false; ex.extra = true;
            w.ex.push(ex); await save(); redraw();
            toast('Добавлено: ' + ex.name);
          },
        }, 'Добавить'),
        h('button', { class: 'btn ghost', onclick: closed }, 'Отмена'))));
  }
  closed();
  return box;
}

function exCard(ex, ctx, ssTag) {
  const { w, workouts, save, redraw } = ctx;
  const last = lastSessionFor(workouts, ex.id, w.id, w.date);
  let editing = false;
  const rows = h('div', { class: 'sets' });
  const card = h('article', { class: 'ex' + (ssTag ? ' in-ss' : '') + (ex.extra ? ' extra' : '') });

  const restBtn = h('button', {
    class: 'rest-btn', onclick: () => startTimer(ex.restMin, ex.name),
    'aria-label': 'Запустить таймер отдыха',
  }, '⏱ ', restLabel(ex.restMin, ex.restMax));

  const doneCount = () => ex.sets.filter(s => s.done).length;
  const counter = h('span', { class: 'ex-count' });
  const upd = () => { counter.textContent = `${doneCount()}/${ex.sets.length}`; card.classList.toggle('complete', ex.sets.length > 0 && doneCount() === ex.sets.length); };

  const drawRows = () => {
    rows.innerHTML = '';
    const prs = prSets(workouts, w, ex);
    ex.sets.forEach((st, idx) => rows.append(setRow(st, idx, prs.has(idx))));
    upd();
  };

  const setRow = (st, idx, isPR) => {
    const isLast = idx === ex.sets.length - 1;
    const row = h('div', { class: 'set' + (st.done ? ' done' : '') });
    const field = (key, label, step, min, dec) => {
      const inp = h('input', {
        type: 'text', inputmode: dec ? 'decimal' : 'numeric', enterkeyhint: 'done', autocomplete: 'off',
        value: st[key] == null ? '' : fmtNum(st[key], 2), 'aria-label': `${label}, подход ${idx + 1}`, placeholder: '—',
        oninput: () => { st[key] = num(inp.value); save(); },
        onchange: () => { if (st.done) drawRows(); },
        onfocus: () => inp.select(),
      });
      const bump = d => {
        const v = Math.max(min, Math.round(((st[key] ?? (d > 0 ? 0 : min)) + d) * 100) / 100);
        st[key] = v; inp.value = fmtNum(v, 2); save();
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
    row.append(
      doneBtn,
      field('w', 'кг', 2.5, 0, true),
      field('reps', 'повт', 1, 0, false),
      field('rir', 'RIR', 1, 0, false));
    if (isPR) row.append(h('div', { class: 'set-pr' }, '★ рекорд'));
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
  const drawNote = (focus) => {
    if (ex.note == null && !focus) { noteBox.replaceChildren(); return; }
    const inp = h('input', { type: 'text', value: ex.note || '', placeholder: 'сиденье на 4, болело плечо…', 'aria-label': 'Заметка к упражнению', oninput: e => { ex.note = e.target.value; save(); } });
    noteBox.replaceChildren(h('span', {}, '✎'), inp);
    if (focus) inp.focus();
  };

  const meta = `${ex.target ?? ex.sets.length} × ${range(ex.repMin, ex.repMax)} · RIR ${range(ex.rirMin, ex.rirMax)}`;
  card.append(...[
    h('div', { class: 'ex-head' },
      ssTag ? h('span', { class: 'ss-tag' }, ssTag) : null,
      h('div', { class: 'ex-title' },
        h('h3', {}, ex.name),
        h('div', { class: 'ex-meta' }, ex.extra ? h('span', { class: 'extra-tag' }, 'разовое') : null, meta, ' · ', h('span', { class: 'muscle' }, ex.muscle))),
      counter),
    h('div', { class: 'ex-flags' },
      restBtn,
      ex.failLast ? h('span', { class: 'flag' }, 'последний подход 0–1') : h('span', { class: 'flag muted' }, 'без отказа')),
    ex.warmup ? h('div', { class: 'warm' }, 'Разминка: ', ex.warmup) : null,
    h('div', { class: 'last' }, last
      ? [h('span', { class: 'last-lbl' }, 'Прошлый раз · ' + fmtDate(last.date)),
        h('span', { class: 'last-sets' }, last.sets.map(s => `${fmtNum(s.w, 2)}×${s.reps ?? '—'}${s.rir != null ? ` @${s.rir}` : ''}`).join('   ')),
        last.note ? h('span', { class: 'last-note' }, '✎ ' + last.note) : null]
      : h('span', { class: 'last-lbl' }, 'Прошлого раза ещё нет')),
    rows,
    noteBox,
    h('div', { class: 'ex-foot' },
      h('button', { class: 'btn small', onclick: () => { const p = ex.sets[ex.sets.length - 1]; ex.sets.push({ w: p?.w ?? null, reps: p?.reps ?? null, rir: p?.rir ?? null, done: false }); save(); drawRows(); } }, '+ Подход'),
      h('button', { class: 'btn small ghost', onclick: e => { editing = !editing; e.target.textContent = editing ? 'Готово' : 'Изменить'; drawRows(); } }, 'Изменить'),
      ex.note == null ? h('button', { class: 'btn small ghost', 'aria-label': 'Добавить заметку', onclick: e => { e.target.remove(); drawNote(true); } }, '✎') : null,
      ex.extra ? h('button', {
        class: 'btn small danger', onclick: () => {
          const i = w.ex.indexOf(ex); w.ex.splice(i, 1); save(); redraw();
          undoToast(`«${ex.name}» убрано`, () => { w.ex.splice(i, 0, ex); save(); redraw(); });
        },
      }, 'Убрать') : null),
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

export async function renderHistory(root) {
  const all = await allWorkouts();
  const workouts = all.filter(w => w.ex.some(e => e.sets.some(s => s.done)) || w.ex.some(e => e.sets.some(s => s.w != null)));
  root.append(h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, h('a', { href: '#today' }, '← Сегодня')), h('h1', {}, 'История')));
  if (!workouts.length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, '0'), h('h2', {}, 'Тренировок пока нет'), h('p', {}, 'Отметьте первый подход на экране «Сегодня», и тренировка появится здесь.'), h('a', { class: 'btn primary', href: '#today' }, 'К тренировке')));
    return;
  }
  const calBox = h('div');
  const drawCal = () => calBox.replaceChildren(calendar(workouts, drawCal));
  drawCal();
  const ul = h('div', { class: 'hist' });
  for (const w of workouts) {
    const done = w.ex.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    const vol = w.ex.reduce((a, e) => a + e.sets.filter(s => s.done).reduce((b, s) => b + (s.w || 0) * (s.reps || 0), 0), 0);
    const dur = workoutDuration(w);
    const prs = prCount(all, w);
    ul.append(h('a', { class: 'hist-item', href: '#workout/' + w.id },
      h('div', { class: 'hist-date' }, h('b', {}, String(parseDate(w.date).getDate())), h('small', {}, fmtDate(w.date).split(' ')[1])),
      h('div', { class: 'hist-body' }, h('div', { class: 'hist-name' }, w.dayName, prs ? h('span', { class: 'pr-chip' }, `★ ${prs}`) : null),
        h('div', { class: 'hist-sub' }, [`${done} ${plural(done, 'подход', 'подхода', 'подходов')}`, `тоннаж ${fmtNum(vol, 0)} кг`, dur != null ? fmtDuration(dur) : null].filter(Boolean).join(' · ')),
        w.note ? h('div', { class: 'hist-note' }, '✎ ' + w.note) : null),
      h('span', { class: 'chev' }, '›')));
  }
  root.append(calBox, ul);
}
