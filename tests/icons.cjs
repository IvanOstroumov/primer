const { chromium } = require('playwright');
const fs = require('fs'); (async () => {
const svg = fs.readFileSync('icons/icon.svg', 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
async function shot(size, file, maskable) {
  const inner = maskable ? svg.replace('rx="112"', 'rx="0"').replace('<g ', '<g transform="translate(51 51) scale(.8)" ').replace('<rect x="140"', '<rect transform="translate(51 51) scale(.8)" x="140"') : svg;
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:transparent">${inner.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: file, omitBackground: true });
}
await shot(192, 'icons/icon-192.png');
await shot(512, 'icons/icon-512.png');
await shot(512, 'icons/icon-maskable-512.png', true);
await shot(180, 'icons/apple-touch-icon.png', true);
await b.close();
})();
