// Contraste WCAG de los colores de texto sobre cada superficie, en los dos temas.
//   node scripts/contrast.js      falla si algún texto baja de 4,5:1
// Sobre --surface-3 (avisos, tooltips, menús) el texto de color y el secundario solo aparecen
// en negrita o en detalles, y basta el 3:1 de texto grande.
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):(#[0-9a-f]{3,6})/gi)].map((m) => [m[1], m[2]]));
const themes = {
  oscuro: block(/:root\{([^}]*)\}/),
  claro: block(/:root\[data-theme=light\]\{([^}]*)\}/),
};
const lum = (hex) => {
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
let ok = true;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const fg of ['tx', 'tx-2', 'mu', 'gain', 'loss', 'warn']) {
    const cells = ['bg', 'surface', 'surface-2', 'surface-3'].map((bg) => {
      const r = ratio(t[fg], t[bg]);
      const need = bg === 'surface-3' && !['tx', 'tx-2'].includes(fg) ? 3 : 4.5;
      if (r < need) ok = false;
      return `${bg} ${r.toFixed(2)}${r < need ? ' ✖' : ''}`;
    });
    console.log(`  --${fg.padEnd(5)} ${cells.join(' · ')}`);
  }
}
if (!ok) { console.error('\nHay combinaciones por debajo de AA.'); process.exit(1); }
