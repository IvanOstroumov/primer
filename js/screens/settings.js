// Настройки: экспорт/импорт, дата старта, тема, сброс.
import { h, fmtDateFull, isoDate, toast, num, fmtNum } from '../util.js';
import { all, replaceAll, wipeAll, STORES } from '../db.js';
import { state, loadState, saveSettings, applyTheme } from '../state.js';
import { blobToDataURL, dataURLToBlob } from '../photos.js';

export async function buildBackup() {
  const data = { app: 'zal', format: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) data[s] = await all(s);
  data.photos = await Promise.all(data.photos.map(async p => ({ id: p.id, date: p.date, dataUrl: await blobToDataURL(p.blob) })));
  return data;
}

export async function restoreBackup(data) {
  if (!data || data.app !== 'zal' || !Array.isArray(data.kv) || !Array.isArray(data.workouts) || !Array.isArray(data.metrics)) throw new Error('Это не файл резервной копии «Зал»');
  const photos = await Promise.all((data.photos || []).map(async p => ({ id: p.id, date: p.date, blob: await dataURLToBlob(p.dataUrl) })));
  await replaceAll({ kv: data.kv, workouts: data.workouts, metrics: data.metrics, photos });
  await loadState();
  if (data.exportedAt) { state.settings.lastExport = data.exportedAt; await saveSettings(); }
}

// CSV для русского Excel: разделитель «;», десятичная запятая, UTF-8 с BOM, CRLF
const cell = v => {
  if (v == null) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  const t = String(v);
  return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
const toCSV = rows => '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';

export async function buildCSV() {
  const ws = (await all('workouts')).sort((a, b) => (a.date + (a.created || '')).localeCompare(b.date + (b.created || '')));
  const tr = [['Дата', 'День', 'Упражнение', 'Мышца', 'Подход', 'Вес, кг', 'Повторы', 'RIR', 'Выполнен', 'Заметка к упражнению', 'Заметка к тренировке']];
  for (const w of ws) for (const e of w.ex) e.sets.forEach((st, i) => {
    tr.push([w.date, w.dayName, e.name, e.muscle, i + 1, st.w, st.reps, st.rir, st.done ? 'да' : 'нет', i === 0 ? e.note || '' : '', i === 0 && e === w.ex[0] ? w.note || '' : '']);
  });
  const ms = (await all('metrics')).sort((a, b) => a.date.localeCompare(b.date));
  const mt = [['Дата', 'Вес, кг', 'Шаги', 'Сон, ч', 'Талия, см'], ...ms.map(m => [m.date, m.weight, m.steps, m.sleep, m.waist])];
  return { workouts: toCSV(tr), metrics: toCSV(mt) };
}

async function saveFiles(files) {
  const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  if (mobile && navigator.canShare?.({ files })) {
    try { await navigator.share({ files }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  for (const f of files) {
    const a = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    await new Promise(r => setTimeout(r, 300));
  }
  return true;
}

export function renderSettings(root) {
  const s = state.settings;
  const rerender = () => { root.innerHTML = ''; renderSettings(root); };

  const exportBtn = h('button', {
    class: 'btn primary wide', onclick: async () => {
      exportBtn.disabled = true; exportBtn.textContent = 'Готовлю файл…';
      try {
        const data = await buildBackup();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const name = `zal-backup-${isoDate()}.json`;
        const file = new File([blob], name, { type: 'application/json' });
        let done = false;
        if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
          try { await navigator.share({ files: [file], title: name }); done = true; } catch (e) { if (e.name === 'AbortError') { rerender(); return; } }
        }
        if (!done) {
          const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }
        s.lastExport = new Date().toISOString(); await saveSettings(); toast('Экспорт готов');
      } catch (e) { toast('Ошибка экспорта: ' + e.message); }
      rerender();
    },
  }, 'Экспорт — скачать JSON');

  const fileIn = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'imp-in',
    onchange: async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch { toast('Файл не читается как JSON'); return; }
      if (data?.app !== 'zal') { toast('Это не файл резервной копии «Зал»'); return; }
      const n = (data.workouts || []).length, m = (data.metrics || []).length, p = (data.photos || []).length;
      if (!confirm(`Импорт заменит ВСЕ текущие данные.\n\nВ файле (${data.exportedAt ? fmtDateFull(data.exportedAt.slice(0, 10)) : 'без даты'}): тренировок ${n}, записей метрик ${m}, фото ${p}.\n\nПродолжить?`)) return;
      try { await restoreBackup(data); applyTheme(); toast('Данные восстановлены'); } catch (err) { toast('Ошибка импорта: ' + err.message); }
      rerender();
    },
  });

  const goal = (k, label, mode) => h('label', { class: 'field' }, h('span', {}, label),
    h('input', { type: 'text', inputmode: mode, value: fmtNum(s.goals[k], 1), oninput: async e => { const v = num(e.target.value); if (v != null && v >= 0) { s.goals[k] = v; await saveSettings(); } } }));

  const last = s.lastExport ? new Date(s.lastExport) : null;
  const daysAgo = last ? Math.floor((Date.now() - last) / 864e5) : null;

  root.append(
    h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Данные хранятся только на этом устройстве'), h('h1', {}, 'Настройки')),
    h('section', { class: 'card' },
      h('h2', { class: 'card-h' }, 'Резервная копия'),
      h('p', { class: 'export-date' + (daysAgo == null || daysAgo > 14 ? ' warn' : '') },
        last ? `Последний экспорт: ${fmtDateFull(isoDate(last))}, ${last.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Экспорта ещё не было'),
      exportBtn,
      h('label', { class: 'btn wide', for: 'imp-in' }, 'Импорт из файла…'), fileIn,
      h('p', { class: 'muted small' }, 'Файл включает программу, все тренировки, метрики, фото и настройки. Импорт полностью заменяет текущие данные (с подтверждением).')),

    h('section', { class: 'card' },
      h('h2', { class: 'card-h' }, 'Параметры'),
      h('label', { class: 'field' }, h('span', {}, 'Дата старта возврата'),
        h('input', { type: 'date', value: s.rampStart || '', onchange: async e => { s.rampStart = e.target.value || null; await saveSettings(); toast('Сохранено'); } })),
      h('div', { class: 'field' }, h('span', {}, 'Тема'),
        h('div', { class: 'seg' }, [['auto', 'Системная'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, t]) =>
          h('button', { class: s.theme === k ? 'on' : '', 'aria-pressed': String(s.theme === k), onclick: async () => { s.theme = k; await saveSettings(); applyTheme(); rerender(); } }, t)))),
      h('div', { class: 'field' }, h('span', {}, 'Единицы'), h('div', { class: 'static' }, 'кг и см (фиксировано)'))),

    h('section', { class: 'card' },
      h('h2', { class: 'card-h' }, 'Цели на графиках'),
      h('p', { class: 'muted small' }, 'Показываются полосой на графиках шагов и сна. Только отображение.'),
      h('div', { class: 'goal-grid' },
        goal('stepsLo', 'Шаги от', 'numeric'), goal('stepsHi', 'Шаги до', 'numeric'),
        goal('sleepLo', 'Сон от, ч', 'decimal'), goal('sleepHi', 'Сон до, ч', 'decimal'))),

    h('section', { class: 'card' },
      h('h2', { class: 'card-h' }, 'Таблицы (CSV)'),
      h('p', { class: 'muted small' }, 'Два файла для Excel: тренировки (строка на подход) и метрики. Разделитель «;», десятичная запятая. Это не резервная копия — восстановить данные из CSV нельзя.'),
      h('button', { class: 'btn wide', onclick: async e => {
        const b = e.currentTarget; b.disabled = true;
        try {
          const c = await buildCSV(), d = isoDate();
          await saveFiles([new File([c.workouts], `zal-trenirovki-${d}.csv`, { type: 'text/csv' }), new File([c.metrics], `zal-metriki-${d}.csv`, { type: 'text/csv' })]);
        } catch (err) { toast('Ошибка: ' + err.message); }
        b.disabled = false;
      } }, 'Экспорт CSV')),

    h('section', { class: 'card danger-zone' },
      h('h2', { class: 'card-h' }, 'Сбросить все данные'),
      h('p', { class: 'muted small' }, 'Удалит тренировки, метрики, фото, программу и настройки. Сначала сделайте экспорт.'),
      h('button', {
        class: 'btn danger', onclick: async () => {
          if (!confirm('Удалить ВСЕ данные приложения?')) return;
          if (!confirm('Точно? Это нельзя отменить. Удалить всё?')) return;
          await wipeAll(); await loadState(); applyTheme(); toast('Все данные удалены'); location.hash = '#today';
        },
      }, 'Удалить все данные')),
    h('p', { class: 'muted small center' }, 'Зал · офлайн-приложение · данные не покидают устройство'));
}
