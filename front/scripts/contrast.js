// Contraste WCAG de los colores de texto sobre cada superficie, en los dos temas.
//   node scripts/contrast.js      falla si algún texto baja de 4,5:1
// Sobre --surface-3 (avisos, tooltips, menús) el texto de color y el secundario solo aparecen
// en negrita o en detalles, y basta el 3:1 de texto grande.
import fs from 'node:fs';

// Las hojas que carga main.jsx, en orden: lo que define una después pisa a la anterior.
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const sheets = ['styles.css', ...['redesign.css'].filter((f) => main.includes(`./${f}`))];
const css = sheets.map((f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('\n');
const block = (re) => Object.assign({}, ...[...css.matchAll(re)].map((m) =>
  Object.fromEntries([...m[1].matchAll(/--([\w-]+):(#[0-9a-f]{3,6})/gi)].map((x) => [x[1], x[2]]))));
const themes = {
  oscuro: block(/(?:^|\n):root\{([^}]*)\}/g),
  claro: block(/:root\[data-theme=light\]\{([^}]*)\}/g),
};
console.log(`Hojas: ${sheets.join(', ')}`);
const lum = (hex) => {
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
let ok = true;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const fg of ['tx', 'tx-2', 'mu', 'gain', 'loss', 'warn', ...(t['acc-tx'] ? ['acc-tx'] : [])]) {
    const cells = ['bg', 'surface', 'surface-2', 'surface-3'].map((bg) => {
      const r = ratio(t[fg], t[bg]);
      const need = bg === 'surface-3' && !['tx', 'tx-2'].includes(fg) ? 3 : 4.5;
      if (r < need) ok = false;
      return `${bg} ${r.toFixed(2)}${r < need ? ' ✖' : ''}`;
    });
    if (fg === 'acc-tx' && t['on-acc']) {
      const r = ratio(t['on-acc'], t.acc);
      if (r < 4.5) ok = false;
      cells.push(`texto sobre acento ${r.toFixed(2)}${r < 4.5 ? ' ✖' : ''}`);
    }
    console.log(`  --${fg.padEnd(5)} ${cells.join(' · ')}`);
  }
}
if (!ok) { console.error('\nHay combinaciones por debajo de AA.'); process.exit(1); }
