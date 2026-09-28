// Возврат после перерыва: только информация, программу не меняет.
import { h, isoDate, daysBetween, fmtDateFull, addDays, toast, plural } from '../util.js';
import { state, saveSettings } from '../state.js';
import { RAMP } from '../seed.js';

export function rampInfo(today = isoDate()) {
  const start = state.settings.rampStart;
  if (!start) return null;
  const d = daysBetween(start, today);
  const week = d < 0 ? 0 : Math.floor(d / 7) + 1;
  return { start, daysTo: -d, week, row: RAMP[week - 1] || null };
}

export function renderRamp(root) {
  const info = rampInfo();
  root.append(h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Первые 4 недели'), h('h1', {}, 'Возврат')));

  const hero = h('div', { class: 'ramp-hero' });
  if (!info) hero.append(h('p', {}, 'Укажите дату старта ниже.'));
  else if (info.week === 0) hero.append(h('div', { class: 'big' }, String(info.daysTo)), h('div', {}, `${plural(info.daysTo, 'день', 'дня', 'дней')} до старта · ${fmtDateFull(info.start)}`));
  else if (info.week <= 4) hero.append(h('div', { class: 'big' }, String(info.week)), h('div', {}, `неделя из 4 · старт ${fmtDateFull(info.start)} · конец недели ${fmtDateFull(addDays(info.start, info.week * 7 - 1))}`));
  else hero.append(h('div', { class: 'big' }, '✓'), h('div', {}, `Возврат завершён (неделя ${info.week} с начала). Дальше по основной программе.`));
  root.append(hero);

  root.append(h('label', { class: 'field inline' }, h('span', {}, 'Дата старта'),
    h('input', { type: 'date', value: state.settings.rampStart || '', onchange: async e => { state.settings.rampStart = e.target.value || null; await saveSettings(); toast('Сохранено'); root.innerHTML = ''; renderRamp(root); } })));

  const table = h('div', { class: 'ramp-weeks' });
  for (const r of RAMP) {
    table.append(h('div', { class: 'ramp-week' + (info && info.week === r.w ? ' now' : '') },
      h('div', { class: 'rw-n' }, r.w),
      h('div', { class: 'rw-body' },
        h('div', { class: 'rw-kv' }, h('span', {}, 'Подходы'), h('b', {}, r.sets)),
        h('div', { class: 'rw-kv' }, h('span', {}, 'Запас (RIR)'), h('b', {}, r.rir)),
        h('p', {}, r.rules))));
  }
  root.append(table,
    h('div', { class: 'note' },
      h('p', {}, 'Упражнения те же, что в основной программе. Меняются только подходы и запас.'),
      h('p', {}, 'Крепатура в первые 2 недели нормальна. Если она мешает двигаться, следующую тренировку той же группы не делай в полную силу. Стартовые веса подбирай по запасу, а не по цифре. Ориентир: жим лёжа около 65–70 кг на 8 повторений при 4 в запасе (оценка из документа, не факт).'),
      h('p', { class: 'muted' }, 'Приложение не меняет программу автоматически — это справка.')));
}
