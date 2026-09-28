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
  // Миграция: подтягивания в старой программе → тип «собственный вес»
  for (const d of state.program.days) for (const e of d.exercises) if (!e.kind && e.id === 'pullup') { e.kind = 'bw'; await setKV('program', state.program); }
  // Миграция: добавить боковые дельты в день «Низ» (было 6 серий/нед., стало 9 — в норме 8–12)
  const lower = state.program.days.find(d => d.id === 'lower');
  if (lower && !lower.exercises.some(e => e.id === 'lat_raise2')) {
    const def = defaultProgram().days.find(d => d.id === 'lower').exercises.find(e => e.id === 'lat_raise2');
    const calfIdx = lower.exercises.findIndex(e => e.id === 'calf');
    lower.exercises.splice(calfIdx >= 0 ? calfIdx : lower.exercises.length, 0, def);
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
