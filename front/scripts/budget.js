// Presupuesto de tamaño del front compilado (gzip). Falla el build si se pasa.
//   node scripts/budget.js            comprueba dist/
// Bájalos cuando una mejora los deje por debajo, para no perder lo ganado.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BUDGET_KB = {
  initial: 97, // JS que pide la página al abrir (React y react-dom ya son ~60 KB); subió de 95 con el buscador con acciones y las pestañas deslizantes
  js: 191, // todo el JavaScript, con las secciones que se cargan bajo demanda (las funciones nuevas van ahí; subió con Patrimonio, con la ficha frente al índice con tu dinero, con los externos y con las ventanas de Renta Web)
  css: 16.5, // con el rediseño (redesign.css) y las ventanas de Renta Web
  fonts: 140, // woff2 ya comprimido: se cuenta tal cual
};

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dist', 'assets');
const files = fs.readdirSync(dir);
const kb = (n) => n / 1024;
const html = fs.readFileSync(path.join(dir, '..', 'index.html'), 'utf8');
const total = { initial: 0, js: 0, css: 0, fonts: 0 };
const rows = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const kind = f.endsWith('.js') ? 'js' : f.endsWith('.css') ? 'css' : /\.woff2?$/.test(f) ? 'fonts' : null;
  if (!kind) continue;
  const size = kind === 'fonts' ? buf.length : zlib.gzipSync(buf, { level: 9 }).length;
  total[kind] += size;
  const first = kind === 'js' && html.includes(`/assets/${f}`);
  if (first) total.initial += size;
  rows.push([f, first ? 'js*' : kind, size]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const [f, kind, size] of rows) console.log(`${kb(size).toFixed(1).padStart(7)} KB  ${kind.padEnd(5)} ${f}`);
console.log('(js* = en la carga inicial)');
let ok = true;
console.log('');
for (const [kind, limit] of Object.entries(BUDGET_KB)) {
  const over = kb(total[kind]) > limit;
  ok &&= !over;
  console.log(`${over ? '✖' : '✔'} ${kind.padEnd(7)} ${kb(total[kind]).toFixed(1)} KB de ${limit} KB`);
}
if (!ok) {
  console.error('\nEl front supera su presupuesto de tamaño.');
  process.exit(1);
}
