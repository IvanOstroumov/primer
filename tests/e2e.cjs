// Смоук-тест: node tests/e2e.cjs (нужны playwright и запущенный сервер на :8765)
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.env.OUT || 'tests/out';
fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:8765/';
const errors = [];
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => m.type() === 'error' && errors.push(m.text()));
  p.on('dialog', d => d.accept());
  const noOverflow = async n => ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'нет гориз. скролла: ' + n);

  await p.goto(URL + '#today');
  await p.waitForSelector('.ex');
  ok((await p.textContent('h1')).includes('Верх A'), 'понедельник → Верх A');
  await p.screenshot({ path: OUT + '/01-today-empty.png', fullPage: true });
  // Прошлая тренировка неделю назад (для «прошлого раза», заметки и рекордов)
  await p.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('zal'); q.onsuccess = () => r(q.result); });
    const d = new Date(); d.setDate(d.getDate() - 7);
    const iso = d.toISOString().slice(0, 10);
    const t = db.transaction('workouts', 'readwrite');
    t.objectStore('workouts').put({ id: 'old1', date: iso, created: iso + 'T10:00:00Z', dayId: 'upperA', dayName: 'Верх A', note: 'старт',
      ex: [{ id: 'incline_db', name: 'Жим гантелей на наклонной', muscle: 'Грудь', target: 3, repMin: 6, repMax: 10, rirMin: 2, rirMax: 2, restMin: 120, restMax: 180, note: 'скамья 30°',
        sets: [{ w: 20, reps: 8, rir: 2, done: true, at: iso + 'T10:00:00Z' }, { w: 20, reps: 8, rir: 2, done: true, at: iso + 'T10:41:00Z' }] }] });
    await new Promise(r => t.oncomplete = r);
  });
  await p.reload(); await p.waitForSelector('.ex');
  ok((await p.textContent('.last-note')).includes('скамья 30°'), 'заметка прошлого раза видна');
  ok(await p.locator('.ex').first().locator('.cell input').nth(0).inputValue() === '20', 'предзаполнено из прошлого раза');
  await noOverflow('today');

  // Ввод подхода
  const first = p.locator('.ex').first();
  await first.locator('.cell input').nth(0).fill('22,5');
  await first.locator('.cell input').nth(1).fill('8');
  await first.locator('.rir-chips button', { hasText: /^1$/ }).first().click(); // RIR 1
  await first.locator('.done-btn').first().click();
  ok(await p.isVisible('#timer'), 'таймер запущен после подхода');
  ok(await p.locator('.set-pr').count() === 1, 'рекорд отмечен');
  ok((await first.locator('.set-diff').first().textContent()).includes('+2,5 кг'), 'разница с прошлым разом');
  ok(await p.isVisible('.live-clock'), 'секундомер тренировки');
  // Отмена
  await first.locator('.done-btn').nth(1).click();
  ok(await first.locator('.set.done').count() === 2, 'второй подход отмечен');
  await p.click('#undo button');
  ok(await first.locator('.set.done').count() === 1, 'отмена сработала');
  // Заметка к упражнению
  await first.locator('button[aria-label="Добавить заметку"]').click();
  await first.locator('.ex-note input').fill('гантели 22,5 заняты');
  // Разовое упражнение
  await p.click('text=+ Упражнение в эту тренировку');
  await p.fill('input[aria-label="Новое упражнение"]', 'Шраги');
  await p.click('.add-ex button:has-text("Добавить")');
  await p.waitForSelector('.ex.extra');
  await p.locator('.ex.extra button:has-text("Убрать")').click();
  ok(await p.locator('.ex.extra').count() === 0, 'разовое убрано');
  await p.click('#undo button');
  ok(await p.locator('.ex.extra').count() === 1, 'разовое возвращено отменой');
  await p.fill('.wnote textarea', 'спал 7 ч');
  // Как в прошлый раз
  await first.locator('.cell input').nth(2).fill('99');
  await first.locator('.repeat-btn').click();
  ok(await first.locator('.cell input').nth(2).inputValue() === '20', 'как в прошлый раз');
  // Пропуск
  const second = p.locator('.ex').nth(1);
  await second.locator('button:has-text("Пропустить")').click();
  await second.locator('.skip-pick button:has-text("занято")').click();
  ok(await p.locator('.ex.skipped').count() === 1 && (await p.locator('.ex.skipped').textContent()).includes('занято'), 'пропуск упражнения');
  ok((await p.textContent('.timer-time')).startsWith('2:0') || (await p.textContent('.timer-time')).startsWith('1:5'), 'таймер ~2:00');
  await p.screenshot({ path: OUT + '/02-today-logged.png', fullPage: false });
  await p.reload(); await p.waitForSelector('.ex');
  ok(await p.locator('.ex').first().locator('.cell input').nth(0).inputValue() === '22,5', 'вес сохранился после перезагрузки');
  ok(await p.locator('.set.done').count() === 1, 'отметка подхода сохранилась');
  ok(await p.locator('.superset').count() === 1, 'суперсет показан парой');

  // История
  ok(await p.locator('.ex').first().locator('.ex-note input').inputValue() === 'гантели 22,5 заняты', 'заметка сохранилась');
  await p.goto(URL + '#history'); await p.waitForSelector('.hist-item');
  ok(await p.locator('.hist-item').count() === 2, 'история: 2 тренировки');
  ok(await p.locator('.pr-chip').count() === 1, 'рекорд в истории');
  ok(await p.locator('.cal-c.on').count() >= 1, 'календарь');
  ok((await p.textContent('.hist')).includes('41 мин'), 'длительность');
  ok((await p.textContent('.wk')).includes('Эта неделя'), 'недельная сводка');
  await p.goto(URL + '#history/records'); await p.waitForSelector('.pr-what');
  ok((await p.textContent('.hist')).includes('Жим гантелей'), 'лента рекордов');
  await p.goto(URL + '#ex/incline_db'); await p.waitForSelector('.ex-hist-row');
  ok(await p.locator('.ex-hist-row').count() === 2 && (await p.textContent('.page')).includes('скамья 30°'), 'страница упражнения');
  await p.screenshot({ path: OUT + '/02c-exercise.png', fullPage: true });
  await noOverflow('exercise');
  await p.goto(URL + '#history'); await p.waitForSelector('.hist-item');
  await p.screenshot({ path: OUT + '/02b-history.png', fullPage: true });
  await noOverflow('history');

  // Другой день: прошлый раз
  // Тело
  await p.goto(URL + '#body/log'); await p.waitForSelector('.metric input');
  await p.locator('.metric input').nth(0).fill('71,4');
  await p.locator('.metric input').nth(1).fill('6500');
  await p.locator('.metric input').nth(2).fill('7,5');
  await p.locator('.metric input').nth(3).fill('79');
  // Ещё пара дней через IndexedDB
  await p.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('zal'); q.onsuccess = () => r(q.result); });
    const t = db.transaction('metrics', 'readwrite');
    for (let i = 1; i < 20; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      t.objectStore('metrics').put({ date: iso, weight: 71 + Math.sin(i) * .6 + i * .03, steps: 5000 + i * 150, sleep: 6 + (i % 4) * .5, ...(i % 7 === 0 ? { waist: 79 + i * .05 } : {}) });
    }
    await new Promise(r => t.oncomplete = r);
  });
  await p.reload(); await p.waitForSelector('.tbl');
  await p.screenshot({ path: OUT + '/03-body.png', fullPage: true });
  await noOverflow('body');
  await p.goto(URL + '#body/charts'); await p.waitForSelector('svg.chart');
  await p.locator('svg.chart').click({ position: { x: 200, y: 80 } });
  await p.screenshot({ path: OUT + '/04-chart-weight.png', fullPage: true });
  await p.click('.chip:has-text("Шаги")'); await p.waitForSelector('svg.chart rect.band');
  ok(true, 'полоса цели на шагах');
  await p.click('button:has-text("4 нед")');
  await p.click('button:has-text("Всё")'); await p.waitForSelector('svg.chart');
  await p.screenshot({ path: OUT + '/04b-steps.png', fullPage: true });
  await p.click('.chip:has-text("Упражнения")'); await p.waitForSelector('svg.chart');
  await p.screenshot({ path: OUT + '/05-chart-ex.png', fullPage: true });

  // Фото
  await p.goto(URL + '#body/photos'); await p.waitForSelector('#ph-in', { state: 'attached' });
  await p.setInputFiles('#ph-in', 'icons/icon-512.png');
  await p.waitForSelector('.ph');
  await p.setInputFiles('#ph-in', 'icons/icon-192.png');
  await p.waitForFunction(() => document.querySelectorAll('.ph').length === 2);
  await p.locator('.ph-img').nth(0).click(); await p.waitForTimeout(100);
  await p.locator('.ph-img').nth(1).click(); await p.waitForSelector('.compare');
  ok(true, 'сравнение фото');
  await p.screenshot({ path: OUT + '/06-photos.png', fullPage: true });

  // Программа
  await p.goto(URL + '#program'); await p.waitForSelector('.vol-row');
  const vol = await p.$$eval('.vol-row', rs => Object.fromEntries(rs.map(r => [r.children[0].textContent, +r.children[2].textContent.split('/')[1]])));
  ok(vol['Трицепс'] === 8 && vol['Спина'] === 12 && vol['Бицепс'] === 11 && vol['Грудь'] === 8, 'объём: ' + JSON.stringify(vol));
  ok(/1\s*\/ 8/.test(await p.locator('.vol-row', { hasText: 'Грудь' }).textContent()), 'сделано/план по груди');
  await p.locator('.pex-head').first().click();
  await p.fill('input[type=url]', 'https://example.com/video');
  await p.goto(URL + '#ex/incline_db'); await p.waitForSelector('.ex-page-meta');
  ok(await p.locator('.ex-page-meta a:has-text("Техника")').count() === 1, 'ссылка на технику');
  ok(await p.locator('.ex', { hasText: 'Подтягивания' }).count() === 0, 'сегодня Верх A');
  await p.goto(URL + '#today/upperB'); await p.waitForSelector('.ex');
  ok((await p.locator('.ex', { hasText: 'Подтягивания' }).textContent()).includes('± кг'), 'подтягивания: свой вес');
  await p.goto(URL + '#program'); await p.waitForSelector('.pex-head');
  await p.screenshot({ path: OUT + '/07-program.png', fullPage: true });
  await noOverflow('program');

  for (const r of ['plan', 'ramp', 'more', 'settings']) {
    await p.goto(URL + '#' + r); await p.waitForTimeout(250);
    await p.screenshot({ path: OUT + `/08-${r}.png`, fullPage: true });
    await noOverflow(r);
  }
  await p.goto(URL + '#research'); await p.waitForSelector('.prose h2');
  await p.fill('input[type=search]', 'креатин'); await p.waitForTimeout(400);
  ok(await p.locator('mark').count() >= 3, 'поиск: ' + await p.locator('mark').count());
  ok(await p.locator('.toc li').count() > 15, 'оглавление');
  ok((await p.textContent('.prose')).includes('Gatorade Sports Science Institute'), 'источники на месте');
  await p.screenshot({ path: OUT + '/09-research.png' });
  await noOverflow('research');

  // Экспорт → сброс → импорт
  await p.goto(URL + '#settings'); await p.waitForSelector('button:has-text("Экспорт —")');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Экспорт —")')]);
  const file = OUT + '/backup.json'; await dl.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const csv = [];
  p.on('download', d => csv.push(d));
  await p.click('button:has-text("Экспорт CSV")'); await p.waitForTimeout(1500);
  ok(csv.length === 2, 'CSV: два файла');
  if (csv[0]) { const f = OUT + '/t.csv'; await csv[0].saveAs(f); const t = fs.readFileSync(f, 'utf8'); ok(t.charCodeAt(0) === 0xFEFF && t.includes(';22,5;') && t.includes('гантели 22,5 заняты'), 'CSV: формат Excel'); }
  ok(data.workouts.length === 2 && data.photos.length === 2 && data.metrics.length === 20, 'экспорт: полный');
  await p.waitForSelector('text=Последний экспорт');
  await p.click('text=Удалить все данные');
  await p.waitForSelector('.ex');
  const cnt = await p.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('zal'); q.onsuccess = () => r(q.result); }); return new Promise(r => { const q = db.transaction('workouts').objectStore('workouts').count(); q.onsuccess = () => r(q.result); }); });
  ok(cnt === 0, 'сброс удалил данные');
  await p.goto(URL + '#settings'); await p.waitForSelector('#imp-in', { state: 'attached' });
  await p.setInputFiles('#imp-in', file);
  await p.waitForSelector('text=Последний экспорт');
  await p.goto(URL + '#history'); await p.waitForSelector('.hist-item');
  await p.goto(URL + '#body/photos'); await p.waitForSelector('.ph');
  ok(await p.locator('.ph').count() === 2, 'импорт: фото восстановлены');
  await p.goto(URL + '#today'); await p.waitForSelector('.ex');
  ok(await p.locator('.set.done').count() === 1 && await p.locator('.ex.extra').count() === 1, 'импорт: подход и разовое восстановлены');

  // Офлайн
  await p.goto(URL + '#today'); await p.waitForTimeout(800);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); await p.waitForTimeout(500);
  await ctx.setOffline(true);
  await p.goto(URL + '#research'); await p.waitForSelector('.prose h2', { timeout: 5000 });
  ok(true, 'офлайн: research открывается');
  await ctx.setOffline(false);

  // Тёмная тема и десктоп
  await p.emulateMedia({ colorScheme: 'dark' });
  await p.goto(URL + '#today'); await p.waitForSelector('.ex');
  await p.screenshot({ path: OUT + '/10-today-dark.png', fullPage: true });
  await p.goto(URL + '#plan'); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/11-plan-dark.png' });
  await p.setViewportSize({ width: 1280, height: 860 });
  await p.goto(URL + '#today'); await p.waitForSelector('.ex');
  await p.screenshot({ path: OUT + '/12-desktop.png' });

  ok(errors.length === 0, 'ошибок в консоли нет ' + errors.join(' | '));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
