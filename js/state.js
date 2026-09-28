import { getKV, setKV, all } from './db.js';
import { defaultProgram } from './seed.js';

export const DEFAULT_SETTINGS = {
  theme: 'auto',            // auto | light | dark
  rampStart: '2026-10-05',
  lastExport: null,
};

export const state = { program: null, settings: null };

export async function loadState() {
  state.program = await getKV('program', null);
  if (!state.program) {
    state.program = defaultProgram();
    await setKV('program', state.program);
  }
  state.settings = { ...DEFAULT_SETTINGS, ...(await getKV('settings', {})) };
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
    if (ex && ex.sets.some(s => s.done)) return { date: w.date, sets: ex.sets.filter(s => s.done) };
  }
  return null;
}
