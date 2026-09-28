import { getKV, setKV, all } from './db.js';
import { defaultProgram } from './seed.js';

export const DEFAULT_SETTINGS = {
  theme: 'auto',            // auto | light | dark
  rampStart: '2026-10-05',
  lastExport: null,
  goals: { stepsLo: 8000, stepsHi: 9000, sleepLo: 8, sleepHi: 9 },
};

export const state = { program: null, settings: null };

export async function loadState() {
  state.program = await getKV('program', null);
  if (!state.program) {
    state.program = defaultProgram();
    await setKV('program', state.program);
  }
  const saved = await getKV('settings', {});
  state.settings = { ...DEFAULT_SETTINGS, ...saved, goals: { ...DEFAULT_SETTINGS.goals, ...(saved.goals || {}) } };
}

export const saveProgram = () => setKV('program', state.program);
export const saveSettings = () => setKV('settings', state.settings);

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#111113' : '#f1eee6');
}

// Все тренировки по дате (новые сверху)
export async function allWorkouts() {
  const w = await all('workouts');
  return w.sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created));
}

// Последняя сессия упражнения (до указанной тренировки)
export function lastSessionFor(workouts, exId, excludeWorkoutId, beforeDate) {
  for (const w of workouts) {
    if (w.id === excludeWorkoutId) continue;
    if (beforeDate && w.date > beforeDate) continue;
    const ex = w.ex.find(x => x.id === exId);
    if (ex && ex.sets.some(s => s.done)) return { date: w.date, sets: ex.sets.filter(s => s.done), note: ex.note || '' };
  }
  return null;
}

// Длительность: от первого до последнего отмеченного подхода, в минутах
export function workoutDuration(w) {
  const ts = w.ex.flatMap(e => e.sets.filter(s => s.done && s.at).map(s => Date.parse(s.at))).filter(Number.isFinite);
  if (ts.length < 2) return null;
  return Math.round((Math.max(...ts) - Math.min(...ts)) / 60000);
}

const before = (a, b) => a.date < b.date || (a.date === b.date && (a.created || '') < (b.created || ''));
const epley = (wt, r) => (wt && r ? wt * (1 + r / 30) : 0);

// Рекорды: индексы подходов упражнения, превзошедших все прошлые тренировки по весу или оценке 1ПМ.
// Если прошлых выполненных подходов нет, рекордом ничего не считается.
export function prSets(workouts, w, ex) {
  let bw = -Infinity, be = -Infinity, prior = false;
  for (const o of workouts) {
    if (o.id === w.id || !before(o, w)) continue;
    const e = o.ex.find(x => x.id === ex.id); if (!e) continue;
    for (const s of e.sets) if (s.done && s.w != null && s.reps) { prior = true; bw = Math.max(bw, s.w); be = Math.max(be, epley(s.w, s.reps)); }
  }
  const out = new Set();
  if (!prior) return out;
  ex.sets.forEach((s, i) => {
    if (!s.done || s.w == null || !s.reps) return;
    const e = epley(s.w, s.reps);
    if (s.w > bw || e > be + 1e-9) out.add(i);
    bw = Math.max(bw, s.w); be = Math.max(be, e);
  });
  return out;
}
export const prCount = (workouts, w) => w.ex.reduce((a, e) => a + prSets(workouts, w, e).size, 0);
