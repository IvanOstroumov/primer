// Страница упражнения: вся история, лучшие подходы, заметки, график.
import { h, fmtDate, fmtNum } from '../util.js';
import { state, allWorkouts } from '../state.js';
import { kindOf, loadBwAt, loadOf, scoreOf, volumeOf, setText } from '../load.js';
import { lineChart } from '../charts.js';

export async function renderExercise(root, rawId) {
  const id = decodeURIComponent(rawId || '');
  const bwAt = await loadBwAt();
  const ws = (await allWorkouts()).filter(w => w.ex.some(e => e.id === id));
  const prog = state.program.days.flatMap(d => d.exercises).find(e => e.id === id);
  const latest = ws[0]?.ex.find(e => e.id === id);
  const ex = prog || latest;
  root.append(h('header', { class: 'page-head' },
    h('div', { class: 'eyebrow' }, h('a', { href: '#history', onclick: e => { if (history.length > 1) { e.preventDefault(); history.back(); } } }, '← Назад')),
    h('h1', { class: 'h-ex' }, ex ? ex.name : 'Упражнение')));
  if (!ex) { root.append(h('div', { class: 'empty' }, 'Упражнение не найдено.')); return; }
  const k = kindOf(ex);

  root.append(h('div', { class: 'ex-page-meta' },
    h('span', {}, ex.muscle),
    k === 'bw' ? h('span', {}, 'собственный вес') : k === 'time' ? h('span', {}, 'на время') : null,
    prog ? null : h('span', {}, 'нет в текущей программе'),
    ex.url ? h('a', { href: ex.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn small' }, '▶ Техника') : null));

  const sessions = ws.map(w => {
    const e = w.ex.find(x => x.id === id);
    const done = e.sets.filter(s => s.done && s.reps);
    return { w, e, done };
  });
  const withSets = sessions.filter(s => s.done.length);
  if (!withSets.length) {
    root.append(h('div', { class: 'empty' }, h('h2', {}, 'Пока нет выполненных подходов'), h('p', {}, 'Отметьте подходы в логгере — здесь появится история.')));
  } else {
    // Лучшие подходы
    let bestLoad = null, bestScore = null;
    for (const s of withSets) for (const st of s.done) {
      const l = loadOf(s.e, st, bwAt, s.w.date), sc = scoreOf(s.e, st, bwAt, s.w.date);
      if (k !== 'time' && (!bestLoad || l > bestLoad.v)) bestLoad = { v: l, st, s };
      if (!bestScore || sc > bestScore.v) bestScore = { v: sc, st, s };
    }
    const tile = (v, l, sub) => h('div', { class: 'tile' }, h('div', { class: 'tile-v' }, v), h('div', { class: 'tile-l' }, l), sub ? h('div', { class: 'tile-s' }, sub) : null);
    root.append(h('section', { class: 'card' },
      h('div', { class: 'tiles three' },
        tile(String(withSets.length), 'тренировок'),
        k === 'time'
          ? tile(`${bestScore.v} с`, 'лучшее время', fmtDate(bestScore.s.w.date))
          : tile(`${fmtNum(bestLoad.v, 1)}`, k === 'bw' ? 'макс. нагрузка, кг' : 'макс. вес, кг', `${setText(ex, bestLoad.st, false)} · ${fmtDate(bestLoad.s.w.date)}`),
        k === 'time' ? null : tile(fmtNum(bestScore.v, 1), '1ПМ (Эпли), кг', `${setText(ex, bestScore.st, false)} · ${fmtDate(bestScore.s.w.date)}`)),
      k === 'bw' ? h('p', { class: 'muted small' }, 'Нагрузка = вес тела на дату тренировки (ближайшая предыдущая запись в «Тело») + добавочный вес.') : null));

    // График
    const box = h('div', { class: 'chart-box' });
    const pts = withSets.slice().reverse().map(s => {
      const b = s.done.reduce((a, st) => (scoreOf(s.e, st, bwAt, s.w.date) > scoreOf(s.e, a, bwAt, s.w.date) ? st : a));
      return { x: s.w.date, y: scoreOf(s.e, b, bwAt, s.w.date), note: setText(s.e, b, false) };
    });
    root.append(h('section', { class: 'card' },
      h('div', { class: 'legend' }, h('span', { class: 'key line' }, h('i'), k === 'time' ? 'лучшее время, с' : 'лучший подход — оценка 1ПМ, кг')), box));
    requestAnimationFrame(() => lineChart(box, { series: [{ points: pts, kind: 'line', dots: true, cls: 'accent' }], yFmt: v => fmtNum(v, k === 'time' ? 0 : 1), unit: k === 'time' ? 'с' : 'кг' }));
  }

  // Заметки
  const notes = sessions.filter(s => s.e.note);
  if (notes.length) root.append(h('section', { class: 'card' }, h('h2', { class: 'card-h' }, 'Заметки'),
    h('ul', { class: 'meals' }, notes.map(s => h('li', {}, h('b', {}, fmtDate(s.w.date)), s.e.note)))));

  // Вся история
  if (sessions.length) root.append(h('section', { class: 'card' }, h('h2', { class: 'card-h' }, 'Все тренировки'),
    h('div', { class: 'ex-hist' }, sessions.map(s => h('a', { class: 'ex-hist-row', href: '#workout/' + s.w.id },
      h('span', { class: 'ex-hist-d' }, fmtDate(s.w.date)),
      h('span', { class: 'ex-hist-s' }, s.e.skipped ? `пропущено: ${s.e.skipped.text || s.e.skipped.reason}` : s.done.map(st => setText(s.e, st)).join('   ') || '—'),
      h('span', { class: 'ex-hist-v' }, s.done.length && k !== 'time' ? fmtNum(volumeOf(s.e, s.done, bwAt, s.w.date), 0) + ' кг' : ''))))));
}
