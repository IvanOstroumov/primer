// Простые SVG-графики без библиотек.
// lineChart(container, {series:[{points:[{x, y}], kind:'line'|'dots'|'bars', cls}], yFmt, xFmt, yUnit})
// x — дата 'YYYY-MM-DD'.
import { parseDate, fmtDate, fmtNum, h } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

function niceTicks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min, step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(6));
  return t;
}

export function lineChart(box, { series, yFmt = v => fmtNum(v), unit = '', height = 200 }) {
  box.innerHTML = '';
  const pts = series.flatMap(se => se.points);
  if (pts.length === 0) { box.append(h('div', { class: 'chart-empty' }, 'Пока нет данных')); return; }
  const W = Math.max(280, box.clientWidth || 320), H = height;
  const pad = { l: 40, r: 10, t: 12, b: 24 };
  const xs = pts.map(p => parseDate(p.x).getTime());
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  const hasBars = series.some(se => se.kind === 'bars');
  if (x0 === x1 || hasBars) { x0 -= 4 * 864e5; x1 += 4 * 864e5; }
  const ys = pts.map(p => p.y);
  const ticks = niceTicks(Math.min(...ys, hasBars ? 0 : Infinity), Math.max(...ys));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = t => pad.l + (t - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = v => pad.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (const t of ticks) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), class: 'grid' }));
    const tx = s('text', { x: pad.l - 6, y: Y(t) + 4, class: 'tick', 'text-anchor': 'end' }); tx.textContent = yFmt(t); svg.append(tx);
  }
  // Подписи по X: начало, середина, конец
  const xl = [x0, (x0 + x1) / 2, x1];
  xl.forEach((t, i) => {
    const tx = s('text', { x: X(t), y: H - 6, class: 'tick', 'text-anchor': ['start', 'middle', 'end'][i] });
    const d = new Date(t); tx.textContent = fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    svg.append(tx);
  });

  const hits = [];
  for (const se of series) {
    const p = se.points.map(q => ({ ...q, px: X(parseDate(q.x).getTime()), py: Y(q.y) }));
    if (se.kind === 'bars') {
      const bw = Math.max(6, Math.min(26, (W - pad.l - pad.r) / (p.length + 2) * 0.6));
      for (const q of p) svg.append(s('rect', { x: q.px - bw / 2, y: q.py, width: bw, height: Math.max(0, Y(y0) - q.py), rx: 3, class: 'bar ' + (se.cls || '') }));
    } else if (se.kind === 'line' && p.length > 1) {
      svg.append(s('path', { d: p.map((q, i) => (i ? 'L' : 'M') + q.px.toFixed(1) + ' ' + q.py.toFixed(1)).join(''), class: 'line ' + (se.cls || '') }));
    }
    if (se.kind === 'dots' || (se.kind === 'line' && (p.length < 2 || se.dots))) {
      for (const q of p) svg.append(s('circle', { cx: q.px, cy: q.py, r: se.kind === 'dots' ? 3.5 : 3, class: 'dot ' + (se.cls || '') }));
    }
    if (!se.noHit) hits.push(...p.map(q => ({ ...q, name: se.name })));
  }

  // Подсказка по тапу/наведению
  const cursor = s('line', { class: 'cursor', y1: pad.t, y2: H - pad.b, x1: -10, x2: -10 });
  const mark = s('circle', { class: 'mark', r: 5, cx: -10, cy: -10 });
  svg.append(cursor, mark);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const show = ev => {
    const r = svg.getBoundingClientRect();
    const mx = (ev.clientX - r.left) * (W / r.width);
    let best = null;
    for (const q of hits) if (!best || Math.abs(q.px - mx) < Math.abs(best.px - mx)) best = q;
    if (!best) return;
    cursor.setAttribute('x1', best.px); cursor.setAttribute('x2', best.px);
    mark.setAttribute('cx', best.px); mark.setAttribute('cy', best.py);
    tip.hidden = false;
    tip.textContent = `${fmtDate(best.x, true)} · ${best.name ? best.name + ': ' : ''}${yFmt(best.y)}${unit ? ' ' + unit : ''}${best.note ? ' · ' + best.note : ''}`;
  };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse' || ev.buttons) show(ev); });
  box.append(tip, svg);
}

// Скользящее среднее за 7 календарных дней (только дни с данными)
export function rolling7(points) {
  return points.map(p => {
    const t = parseDate(p.x).getTime();
    const win = points.filter(q => { const u = parseDate(q.x).getTime(); return u <= t && u > t - 7 * 864e5; });
    return { x: p.x, y: win.reduce((a, q) => a + q.y, 0) / win.length };
  });
}
