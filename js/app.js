import { h } from './util.js';
import { loadState, applyTheme, state } from './state.js';
import { renderToday, renderHistory, renderWorkout } from './screens/today.js';
import { renderBody } from './screens/body.js';
import { renderRamp, rampInfo } from './screens/ramp.js';
import { renderPlan } from './screens/plan.js';
import { renderResearch } from './screens/research.js';
import { renderSettings } from './screens/settings.js';
import { renderExercise } from './screens/exercise.js';

const I = {
  today: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  body: '<path d="M4 19h16M6 16l4-5 3 3 5-7"/>',
  plan: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
};
const NAV = [['today', 'Сегодня'], ['body', 'Тело'], ['plan', 'План'], ['more', 'Ещё']];
const MORE_ROUTES = ['more', 'ramp', 'research', 'settings', 'history', 'workout', 'ex'];

function nav() {
  return h('nav', { class: 'tabbar', 'aria-label': 'Разделы' }, NAV.map(([k, t]) =>
    h('a', { href: '#' + k, 'data-k': k, html: `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg><span>${t}</span>` })));
}

function renderMore(root) {
  const r = rampInfo();
  const item = (href, title, sub) => h('a', { class: 'more-item', href }, h('div', {}, h('b', {}, title), h('small', {}, sub)), h('span', { class: 'chev' }, '›'));
  root.append(h('header', { class: 'page-head' }, h('h1', {}, 'Ещё')),
    h('div', { class: 'more' },
      item('#ramp', 'Возврат', r ? (r.week === 0 ? `старт через ${r.daysTo} дн.` : r.week <= 4 ? `идёт неделя ${r.week} из 4` : 'завершён') : 'укажите дату старта'),
      item('#history', 'История тренировок', 'просмотр, правка, удаление'),
      item('#research', 'Research', 'полный документ с поиском'),
      item('#settings', 'Настройки', 'экспорт, импорт, тема, сброс')));
}

async function route() {
  const [name, arg] = (location.hash.slice(1) || 'today').split('/');
  const main = document.getElementById('main');
  const root = h('div', { class: 'page page-' + name });
  main.replaceChildren(root);
  const active = MORE_ROUTES.includes(name) ? 'more' : name;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.k === active));
  try {
    switch (name) {
      case 'today': await renderToday(root, arg); break;
      case 'history': await renderHistory(root, arg); break;
      case 'ex': await renderExercise(root, arg); break;
      case 'workout': await renderWorkout(root, arg); break;
      case 'body': await renderBody(root, arg); break;
      case 'ramp': renderRamp(root); break;
      case 'plan': renderPlan(root); break;
      case 'research': await renderResearch(root); break;
      case 'settings': renderSettings(root); break;
      case 'more': renderMore(root); break;
      default: location.hash = '#today'; return;
    }
  } catch (e) {
    console.error(e);
    root.append(h('div', { class: 'empty' }, h('h2', {}, 'Что-то пошло не так'), h('p', {}, String(e.message || e))));
  }
  if (!arg || name !== 'body') window.scrollTo(0, 0);
}

async function start() {
  await loadState();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  document.body.append(nav());
  window.addEventListener('hashchange', route);
  await route();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__zal = state;
}
start();
