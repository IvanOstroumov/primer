// Таймер отдыха: одна глобальная панель над навигацией.
import { h, fmtRest } from './util.js';

let endAt = 0, total = 0, tick = null, ctx = null, label = '', endTimeout = null, notified = false;
let bar;

function ensureBar() {
  if (bar) return bar;
  bar = h('div', { id: 'timer', class: 'timer', hidden: true, role: 'timer', 'aria-live': 'off' },
    h('div', { class: 'timer-prog' }),
    h('button', { class: 'tbtn', 'aria-label': 'Минус 15 секунд', onclick: () => adjust(-15) }, '−15'),
    h('div', { class: 'timer-mid' },
      h('div', { class: 'timer-time' }, '0:00'),
      h('div', { class: 'timer-label' })),
    h('button', { class: 'tbtn', 'aria-label': 'Плюс 15 секунд', onclick: () => adjust(15) }, '+15'),
    h('button', { class: 'tbtn stop', 'aria-label': 'Остановить таймер', onclick: stop }, '✕'));
  document.body.append(bar);
  document.addEventListener('visibilitychange', render);
  return bar;
}

function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

function beep() {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    [0, 0.25, 0.5].forEach((d, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = i === 2 ? 1320 : 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + d); o.stop(t0 + d + 0.2);
    });
  } catch { /* звук недоступен */ }
}

// Уведомление, если приложение свёрнуто. Без push-сервера в фоне срабатывает не всегда
// (Android — обычно, iOS — почти никогда); при возврате панель покажет, сколько прошло.
function askPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* нет API */ }
}
async function notify() {
  if (notified || !document.hidden) return;
  notified = true;
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: label ? `Отдых окончен · ${label}` : 'Отдых окончен', tag: 'rest', renotify: true, vibrate: [300, 150, 300], icon: 'icons/icon-192.png' };
    if (reg) await reg.showNotification('Пора!', opts); else new Notification('Пора!', opts);
  } catch { /* уведомления недоступны */ }
}

export function startTimer(sec, lbl = '') {
  ensureBar();
  unlockAudio();
  askPermission();
  notified = false;
  total = sec; label = lbl;
  endAt = Date.now() + sec * 1000;
  bar.hidden = false; bar.classList.remove('done');
  document.body.classList.add('has-timer');
  clearInterval(tick);
  tick = setInterval(render, 250);
  scheduleEnd();
  render();
}

function scheduleEnd() {
  clearTimeout(endTimeout);
  endTimeout = setTimeout(() => { render(); notify(); }, Math.max(0, endAt - Date.now()) + 50);
}

function adjust(d) {
  if (!endAt) return;
  const left = Math.max(0, endAt - Date.now());
  if (bar.classList.contains('done')) { startTimer(Math.max(15, d), label); return; }
  endAt = Date.now() + Math.max(0, left + d * 1000);
  total = Math.max(total + d, 1);
  notified = false;
  scheduleEnd();
  render();
}

export function stop() {
  clearInterval(tick); clearTimeout(endTimeout); tick = null; endAt = 0;
  if (bar) { bar.hidden = true; bar.classList.remove('done'); }
  document.body.classList.remove('has-timer');
}

function render() {
  if (!endAt || !bar) return;
  const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  bar.querySelector('.timer-time').textContent = left > 0 ? fmtRest(left) : 'Пора!';
  const over = Math.floor((Date.now() - endAt) / 1000);
  bar.querySelector('.timer-label').textContent = over >= 3 ? `закончился ${fmtRest(over)} назад · ${label}` : label;
  bar.querySelector('.timer-prog').style.transform = `scaleX(${total ? left / total : 0})`;
  if (left <= 0 && !bar.classList.contains('done')) {
    bar.classList.add('done');
    notify();
    try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* нет вибрации */ }
    beep();
  }
}
