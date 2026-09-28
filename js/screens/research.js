// Research: полный текст research.md, оглавление, поиск по странице.
import { h } from '../util.js';
import { mdToHtml } from '../md.js';

let cache = null;

export async function renderResearch(root) {
  root.append(h('header', { class: 'page-head' }, h('div', { class: 'eyebrow' }, 'Полный документ'), h('h1', {}, 'Research')));
  if (!cache) {
    try {
      const r = await fetch('content/research.md');
      if (!r.ok) throw new Error(r.status);
      cache = mdToHtml(await r.text());
    } catch {
      root.append(h('div', { class: 'empty' }, 'Не удалось загрузить документ. Откройте приложение онлайн один раз, чтобы он сохранился для офлайна.'));
      return;
    }
  }
  const doc = h('article', { class: 'prose', html: cache.html });
  const tocList = h('ol', { class: 'toc' }, cache.toc.filter(t => t.lv === 2).map(t =>
    h('li', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); doc.querySelector('#' + CSS.escape(t.id))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t.text))));
  const toc = h('details', { class: 'card toc-box' }, h('summary', {}, 'Оглавление'), tocList);

  // Поиск
  let hits = [], cur = -1;
  const count = h('span', { class: 'search-count', 'aria-live': 'polite' });
  const input = h('input', { type: 'search', placeholder: 'Поиск по документу', 'aria-label': 'Поиск по документу', enterkeyhint: 'search' });
  const clearMarks = () => { doc.querySelectorAll('mark').forEach(m => m.replaceWith(m.textContent)); doc.normalize(); };
  const go = d => {
    if (!hits.length) return;
    hits[cur]?.classList.remove('cur');
    cur = (cur + d + hits.length) % hits.length;
    hits[cur].classList.add('cur');
    hits[cur].scrollIntoView({ block: 'center', behavior: 'smooth' });
    count.textContent = `${cur + 1} / ${hits.length}`;
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 200); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } });
  function run() {
    clearMarks(); hits = []; cur = -1;
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { count.textContent = ''; return; }
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const low = n.nodeValue.toLowerCase();
      let idx = low.indexOf(q); if (idx < 0) continue;
      let node = n;
      while (idx >= 0) {
        const after = node.splitText(idx);
        const rest = after.splitText(q.length);
        const mk = document.createElement('mark'); mk.textContent = after.nodeValue; after.replaceWith(mk); hits.push(mk);
        node = rest; idx = node.nodeValue.toLowerCase().indexOf(q);
      }
    }
    // Раскрыть найденное: прокрутить к первому
    count.textContent = hits.length ? '' : 'Не найдено';
    if (hits.length) go(1);
  }

  root.append(
    h('div', { class: 'search-bar' }, input, count,
      h('button', { class: 'icon-btn', 'aria-label': 'Предыдущее совпадение', onclick: () => go(-1) }, '↑'),
      h('button', { class: 'icon-btn', 'aria-label': 'Следующее совпадение', onclick: () => go(1) }, '↓')),
    toc, doc);
}
