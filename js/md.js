// Мини-парсер Markdown: заголовки, абзацы, списки, таблицы, цитаты, **жирный**, _курсив_.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])_(.+?)_(?=$|[\s.,;:)])/g, '$1<em>$2</em>');

export function slug(s, used) {
  let b = s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'sec';
  let k = b, i = 2;
  while (used.has(k)) k = `${b}-${i++}`;
  used.add(k); return k;
}

export function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [], toc = [], used = new Set();
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) {
      const lv = m[1].length, id = slug(m[2], used);
      if (lv <= 3 && lv > 1) toc.push({ lv, id, text: m[2] });
      out.push(`<h${lv} id="${id}">${inline(m[2])}</h${lv}>`); i++; continue;
    }
    if (l.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
      const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(rows[0]), body = rows.slice(2).map(cells);
      out.push(`<div class="table-wrap"><table class="tbl"><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (l.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join('\n')).html}</blockquote>`); continue;
    }
    if (/^(-|\d+\.)\s/.test(l)) {
      const ordered = /^\d+\./.test(l), items = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i])) { items.push(lines[i].replace(/^(-|\d+\.)\s+/, '')); i++; }
      const t = ordered ? 'ol' : 'ul';
      out.push(`<${t}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${t}>`); continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||>|-\s|\d+\.\s)/.test(lines[i])) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return { html: out.join('\n'), toc };
}
