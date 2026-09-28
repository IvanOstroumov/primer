// Нагрузка, «лучший подход», объём и рекорды с учётом типа упражнения:
//  reps — обычный вес × повторы;
//  bw   — собственный вес: поле «кг» — добавочный вес (+ отягощение, − помощь),
//         полная нагрузка = вес тела на дату + добавочный;
//  time — поле «повт» хранит секунды.
import { all } from './db.js';
import { e1rm, fmtNum } from './util.js';

export const kindOf = ex => ex.kind || 'reps';

// Вес тела на дату: ближайшая предыдущая запись; если её нет — ближайшая следующая; если записей нет — null
export async function loadBwAt() {
  const ws = (await all('metrics')).filter(m => m.weight != null).sort((a, b) => a.date.localeCompare(b.date));
  return date => {
    let prev = null;
    for (const m of ws) { if (m.date <= date) prev = m.weight; else return prev ?? m.weight; }
    return prev;
  };
}

const valid = (ex, s) => s.done && s.reps && (kindOf(ex) === 'time' || kindOf(ex) === 'bw' || s.w != null);

export function loadOf(ex, s, bwAt, date) {
  if (kindOf(ex) === 'bw') return (bwAt?.(date) ?? 0) + (s.w || 0);
  return s.w || 0;
}

// Оценка подхода для «лучшего подхода» и рекордов
export function scoreOf(ex, s, bwAt, date) {
  if (kindOf(ex) === 'time') return s.reps || 0;
  return e1rm(loadOf(ex, s, bwAt, date), s.reps);
}

export function volumeOf(ex, sets, bwAt, date) {
  return sets.filter(s => valid(ex, s)).reduce((a, s) => a + (kindOf(ex) === 'time' ? s.reps : loadOf(ex, s, bwAt, date) * s.reps), 0);
}

// Текст подхода: «60×8 @2», «+10×8», «45 с»
export function setText(ex, s, withRir = true) {
  const k = kindOf(ex);
  const rir = withRir && s.rir != null ? ` @${s.rir >= 5 ? '5+' : s.rir}` : '';
  if (k === 'time') return `${s.reps ?? '—'} с${s.w ? ` (${fmtNum(s.w, 2)} кг)` : ''}${rir}`;
  if (k === 'bw') return `${s.w > 0 ? '+' : ''}${s.w ? fmtNum(s.w, 2) : 'СВ'}×${s.reps ?? '—'}${rir}`;
  return `${fmtNum(s.w, 2)}×${s.reps ?? '—'}${rir}`;
}

const before = (a, b) => a.date < b.date || (a.date === b.date && (a.created || '') < (b.created || ''));

// Рекорды: подходы, превзошедшие все прошлые тренировки.
// reps/bw — по весу (нагрузке) или оценке 1ПМ; time — по времени. Без прошлых подходов рекордов нет.
export function prSets(workouts, w, ex, bwAt) {
  const k = kindOf(ex);
  let bl = -Infinity, bs = -Infinity, prior = false;
  for (const o of workouts) {
    if (o.id === w.id || !before(o, w)) continue;
    const e = o.ex.find(x => x.id === ex.id); if (!e) continue;
    for (const s of e.sets) if (valid(e, s)) {
      prior = true;
      if (k !== 'time') bl = Math.max(bl, loadOf(e, s, bwAt, o.date));
      bs = Math.max(bs, scoreOf(e, s, bwAt, o.date));
    }
  }
  const out = new Map();
  if (!prior) return out;
  ex.sets.forEach((s, i) => {
    if (!valid(ex, s)) return;
    const l = loadOf(ex, s, bwAt, w.date), sc = scoreOf(ex, s, bwAt, w.date);
    if (k === 'time') { if (sc > bs) out.set(i, 'время'); }
    else if (l > bl + 1e-9) out.set(i, k === 'bw' ? 'нагрузка' : 'вес');
    else if (sc > bs + 1e-9) out.set(i, '1ПМ');
    if (k !== 'time') bl = Math.max(bl, l);
    bs = Math.max(bs, sc);
  });
  return out;
}

export const prCount = (workouts, w, bwAt) => w.ex.reduce((a, e) => a + prSets(workouts, w, e, bwAt).size, 0);
