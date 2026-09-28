// Сегодня / логгер тренировки, история, редактирование прошлой тренировки.
import { h, isoDate, fmtDate, fmtNum, num, uid, range, restLabel, toast, parseDate, plural, WEEKDAYS_SHORT } from '../util.js';
import { put, del, get } from '../db.js';
import { state, allWorkouts, lastSessionFor } from '../state.js';
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
  const save = async () => {
    w.updated = new Date().toISOString();
    await put('workouts', w);
    if (!saved) { saved = true; }
    status.textContent = 'Сохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };
  const status = h('div', { class: 'save-status', 'aria-live': 'polite' }, saved ? 'Сохранено' : 'Черновик: сохранится при первом вводе');
  const wrap = h('div', { class: 'workout' });
  const list = w.ex;
  for (let i = 0; i < list.length; i++) {
    const ex = list[i];
    if (ex.ssNext && list[i + 1]) {
      wrap.append(h('section', { class: 'superset' },
        h('div', { class: 'ss-label' }, 'Суперсет · ', restLabel(list[i + 1].restMin, list[i + 1].restMax), ' между кругами'),
        exCard(ex, w, workouts, save, 'A', null),
        exCard(list[i + 1], w, workouts, save, 'Б', ex)));
      i++;
    } else wrap.append(exCard(ex, w, workouts, save, null, null));
  }
  if (!list.length) wrap.append(h('div', { class: 'empty' }, 'В этом дне нет упражнений.'));
  return h('div', {}, status, wrap);
}

function exCard(ex, w, workouts, save, ssTag, ssPrev) {
  const last = lastSessionFor(workouts, ex.id, w.id, w.date);
  let editing = false;
  const rows = h('div', { class: 'sets' });
  const card = h('article', { class: 'ex' + (ssTag ? ' in-ss' : '') });

  const restBtn = h('button', {
    class: 'rest-btn', onclick: () => startTimer(ex.restMin, ex.name),
    'aria-label': 'Запустить таймер отдыха',
  }, '⏱ ', restLabel(ex.restMin, ex.restMax));

  const doneCount = () => ex.sets.filter(s => s.done).length;
  const counter = h('span', { class: 'ex-count' });
  const upd = () => { counter.textContent = `${doneCount()}/${ex.sets.length}`; card.classList.toggle('complete', ex.sets.length > 0 && doneCount() === ex.sets.length); };

  const drawRows = () => {
    rows.innerHTML = '';
    ex.sets.forEach((st, idx) => rows.append(setRow(ex, st, idx)));
    upd();
  };

  const setRow = (exr, st, idx) => {
    const isLast = idx === exr.sets.length - 1;
    const row = h('div', { class: 'set' + (st.done ? ' done' : '') });
    const field = (key, label, step, min, dec) => {
      const inp = h('input', {
        type: 'text', inputmode: dec ? 'decimal' : 'numeric', enterkeyhint: 'done', autocomplete: 'off',
        value: st[key] == null ? '' : fmtNum(st[key], 2), 'aria-label': `${label}, подход ${idx + 1}`, placeholder: '—',
        oninput: () => { st[key] = num(inp.value); save(); },
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
        st.done = !st.done;
        if (st.done) st.at = new Date().toISOString();
        save();
        row.classList.toggle('done', st.done);
        doneBtn.setAttribute('aria-pressed', String(st.done));
        doneBtn.textContent = st.done ? '✓' : String(idx + 1);
        upd();
        if (st.done && !exr.ssNext) startTimer(exr.restMin, exr.name);
        if (st.done && exr.ssNext) toast('Теперь упражнение Б');
      },
    }, st.done ? '✓' : String(idx + 1));
    row.append(
      doneBtn,
      field('w', 'кг', 2.5, 0, true),
      field('reps', 'повт', 1, 0, false),
      field('rir', 'RIR', 1, 0, false));
    if (exr.failLast && isLast) row.append(h('div', { class: 'set-note' }, 'последний: можно 0–1'));
    if (editing) row.append(h('button', {
      class: 'del-set', 'aria-label': `Удалить подход ${idx + 1}`,
      onclick: () => { exr.sets.splice(idx, 1); save(); drawRows(); },
    }, 'Удалить'));
    return row;
  };

  const meta = `${ex.target ?? ex.sets.length} × ${range(ex.repMin, ex.repMax)} · RIR ${range(ex.rirMin, ex.rirMax)}`;
  card.append(...[
    h('div', { class: 'ex-head' },
      ssTag ? h('span', { class: 'ss-tag' }, ssTag) : null,
      h('div', { class: 'ex-title' },
        h('h3', {}, ex.name),
        h('div', { class: 'ex-meta' }, meta, ' · ', h('span', { class: 'muscle' }, ex.muscle))),
      counter),
    h('div', { class: 'ex-flags' },
      restBtn,
      ex.failLast ? h('span', { class: 'flag' }, 'последний подход 0–1') : h('span', { class: 'flag muted' }, 'без отказа')),
    ex.warmup ? h('div', { class: 'warm' }, 'Разминка: ', ex.warmup) : null,
    h('div', { class: 'last' }, last
      ? [h('span', { class: 'last-lbl' }, 'Прошлый раз · ' + fmtDate(last.date)), h('span', { class: 'last-sets' }, last.sets.map(s => `${fmtNum(s.w, 2)}×${s.reps ?? '—'}${s.rir != null ? ` @${s.rir}` : ''}`).join('   '))]
      : h('span', { class: 'last-lbl' }, 'Прошлого раза ещё нет')),
    rows,
    h('div', { class: 'ex-foot' },
      h('button', { class: 'btn small', onclick: () => { const p = ex.sets[ex.sets.length - 1]; ex.sets.push({ w: p?.w ?? null, reps: p?.reps ?? null, rir: p?.rir ?? null, done: false }); save(); drawRows(); } }, '+ Подход'),
      h('button', { class: 'btn small ghost', onclick: e => { editing = !editing; e.target.textContent = editing ? 'Готово' : 'Изменить'; drawRows(); } }, 'Изменить')),
  ].filter(Boolean));
  drawRows();
  return card;
}

export async function renderHistory(root) {
  const workouts = (await allWorkouts()).filter(w => w.ex.some(e => e.sets.some(s => s.done)) || w.ex.some(e => e.sets.some(s => s.w != null)));
  root.append(h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, h('a', { href: '#today' }, '← Сегодня')), h('h1', {}, 'История')));
  if (!workouts.length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, '0'), h('h2', {}, 'Тренировок пока нет'), h('p', {}, 'Отметьте первый подход на экране «Сегодня», и тренировка появится здесь.'), h('a', { class: 'btn primary', href: '#today' }, 'К тренировке')));
    return;
  }
  const ul = h('div', { class: 'hist' });
  for (const w of workouts) {
    const done = w.ex.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    const vol = w.ex.reduce((a, e) => a + e.sets.filter(s => s.done).reduce((b, s) => b + (s.w || 0) * (s.reps || 0), 0), 0);
    ul.append(h('a', { class: 'hist-item', href: '#workout/' + w.id },
      h('div', { class: 'hist-date' }, h('b', {}, String(parseDate(w.date).getDate())), h('small', {}, fmtDate(w.date).split(' ')[1])),
      h('div', { class: 'hist-body' }, h('div', { class: 'hist-name' }, w.dayName),
        h('div', { class: 'hist-sub' }, `${done} ${plural(done, 'подход', 'подхода', 'подходов')} · тоннаж ${fmtNum(vol, 0)} кг`)),
      h('span', { class: 'chev' }, '›')));
  }
  root.append(ul);
}
