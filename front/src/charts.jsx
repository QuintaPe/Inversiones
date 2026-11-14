import { useId, useState } from 'react';
import { useWidth } from './hooks.js';
import { compact } from './lib/format.js';
import { decimate } from './lib/decimate.js';
import { timeTicks } from './lib/ticks.js';

/**
 * Recorrido con teclado de una gráfica de n puntos: ← → de uno en uno, RePág/AvPág un 10 %,
 * Inicio/Fin a los extremos y Esc para salir. Al entrar con Tab se coloca en el último dato
 * (el más reciente). `set(i | null)` mueve el mismo cursor que el ratón.
 * Devuelve las props del contenedor y el punto activo con teclado (para anunciarlo).
 */
export function useChartKeys(n, hi, set, label) {
  const [kbd, setKbd] = useState(false);
  const hint = useId();
  const clamp = (i) => Math.max(0, Math.min(n - 1, i));
  const onKeyDown = (ev) => {
    if (!n) return;
    if (ev.key === 'Escape') { if (hi != null) { ev.preventDefault(); set(null); } return; }
    const step = Math.max(1, Math.round(n / 10));
    const cur = hi ?? n - 1;
    const to = { ArrowRight: cur + 1, ArrowLeft: cur - 1, PageUp: cur + step, PageDown: cur - step, Home: 0, End: n - 1 }[ev.key];
    if (to == null) return;
    ev.preventDefault();
    setKbd(true);
    set(hi == null ? n - 1 : clamp(to));
  };
  return {
    kbd: kbd && hi != null,
    props: {
      tabIndex: n ? 0 : undefined, role: 'group', 'aria-roledescription': 'gráfica', 'aria-label': label, 'aria-describedby': hint,
      onKeyDown,
      // Solo al llegar con el teclado: un clic ya coloca el cursor donde se pulsa.
      onFocus: (ev) => { if (n && ev.target === ev.currentTarget && ev.currentTarget.matches(':focus-visible')) { setKbd(true); if (hi == null) set(n - 1); } },
      onBlur: (ev) => { if (ev.target === ev.currentTarget && kbd) { setKbd(false); set(null); } },
    },
    hint: <span id={hint} className="sr-only">Usa las flechas para recorrer los datos.</span>,
  };
}

/** Lo que dice la gráfica del punto activo, para lectores de pantalla (el tooltip es visual). */
const Say = ({ children }) => <div className="sr-only" aria-live="polite" aria-atomic="true">{children}</div>;


/** Marcas "redondas" para el eje Y que cubren [min, max]. */
function ticks(min, max, n = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.floor(min / step) * step; v < max + step; v += step) out.push(+v.toFixed(8));
  return out;
}

function Tip({ x, y, w, children }) {
  const right = x > w / 2;
  return (
    <div className="tip" style={{ top: Math.max(0, y), [right ? 'right' : 'left']: right ? w - x + 12 : x + 12 }}>
      {children}
    </div>
  );
}

/**
 * Serie temporal escalonada (una sola serie) con área suave y cursor.
 * points: [{ t: ms, v }] ordenados. tip: (punto) => contenido.
 */
export function StepArea({ points, height = 220, tip, label, bare = false }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const keys = useChartKeys(points.length, hi?.i ?? null, (i) => setHi(i == null ? null : { i, t: points[i].t }), label);
  const m = bare ? { l: 0, r: 0, t: 12, b: 26 } : { l: 46, r: 10, t: 10, b: 24 };
  let body = null;
  if (w > 0 && points.length > 1) {
    const iw = w - m.l - m.r, ih = height - m.t - m.b;
    const t0 = points[0].t, t1 = points.at(-1).t;
    const vs = points.map((p) => p.v);
    // En modo limpio la escala se ajusta al tramo visible, como en las apps de bolsa.
    const lo = bare ? Math.min(...vs) : 0;
    const yt = bare ? [lo, Math.max(...vs) + (Math.max(...vs) - lo) * 0.08 || lo + 1] : ticks(0, Math.max(...vs));
    const yMax = yt.at(-1);
    const X = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * iw;
    const Y = (v) => m.t + ih - ((v - lo) / (yMax - lo || 1)) * ih;
    const idx = decimate(points.length, (i) => points[i].v, (i) => X(points[i].t));
    let d = `M${X(points[0].t)},${Y(points[0].v)}`;
    for (const i of idx) if (i > 0) d += `H${X(points[i].t).toFixed(1)}V${Y(points[i].v).toFixed(1)}`;
    const xt = timeTicks(t0, t1, iw, 70);
    const move = (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      const t = t0 + ((ev.clientX - r.left - m.l) / iw) * (t1 - t0);
      let i = 0;
      while (i < points.length - 1 && points[i + 1].t <= t) i++;
      setHi({ i, t: Math.min(Math.max(t, t0), t1) });
    };
    const hp = hi && points[hi.i];
    body = (
      <>
        <svg width={w} height={height} aria-hidden="true"
          onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHi(null)}>
          {!bare && yt.map((v) => (
            <g key={v}>
              <line className="grid" x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} />
              <text className="axis" x={m.l - 8} y={Y(v)} dy="0.32em" textAnchor="end">{compact(v)}</text>
            </g>
          ))}
          {bare && <line className="base dotted" x1={0} x2={w} y1={Y(points[0].v)} y2={Y(points[0].v)} />}
          {xt.filter((x) => !bare || (X(x.t) > 26 && X(x.t) < w - 26)).map((x) => <text key={x.t} className="axis" x={X(x.t)} y={height - 6} textAnchor="middle">{x.s}</text>)}
          <defs>
            <linearGradient id="area-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--chart)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--chart)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path fill="url(#area-fade)" d={`${d}V${Y(lo)}H${X(t0)}Z`} />
          <path className="line" d={d} />
          {hp && (
            <>
              <line className="cross" x1={X(hi.t)} x2={X(hi.t)} y1={m.t} y2={m.t + ih} />
              <circle className="dot" cx={X(hi.t)} cy={Y(hp.v)} r="4.5" />
            </>
          )}
        </svg>
        {hp && <Tip x={X(hi.t)} y={Y(hp.v) - 54} w={w}>{tip({ ...hp, t: hi.t })}</Tip>}
      </>
    );
  }
  return (
    <div className="chart" ref={ref} style={{ height }} {...keys.props}>
      {body}{keys.hint}
      <Say>{keys.kbd && tip({ ...points[hi.i], t: hi.t })}</Say>
    </div>
  );
}

/**
 * Columnas (una serie; admite valores negativos, que se pintan como pérdida).
 * data: [{ key, label, v }]. tip: (dato) => contenido.
 */
export function Columns({ data, height = 200, tip, label, signed = false }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const keys = useChartKeys(data.length, hi, setHi, label);
  const m = { l: 46, r: 6, t: 10, b: 24 };
  let body = null;
  if (w > 0 && data.length) {
    const iw = w - m.l - m.r, ih = height - m.t - m.b;
    const vs = data.map((d) => d.v);
    const yt = ticks(Math.min(0, ...vs), Math.max(0, ...vs));
    const y0 = yt[0], y1 = yt.at(-1);
    const Y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const band = iw / data.length;
    const bw = Math.max(2, Math.min(24, band - 2));
    const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 52)));
    const bar = (d, i) => {
      const x = m.l + band * i + (band - bw) / 2;
      const top = Y(Math.max(0, d.v)), h = Math.abs(Y(d.v) - Y(0));
      if (h < 0.5) return null;
      const r = Math.min(4, bw / 2, h);
      // Extremo de dato redondeado; base cuadrada.
      const path = d.v >= 0
        ? `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${top + h}Z`
        : `M${x},${top}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + bw - r}Q${x + bw},${top + h} ${x + bw},${top + h - r}V${top}Z`;
      return <path key={d.key} d={path} className={`bar ${signed ? (d.v >= 0 ? 'up' : 'down') : ''} ${hi === i ? 'hi' : ''}`} />;
    };
    const hd = hi != null && data[hi];
    body = (
      <>
        <svg width={w} height={height} aria-hidden="true" onPointerLeave={() => setHi(null)}>
          {yt.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'base' : 'grid'} x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} />
              <text className="axis" x={m.l - 8} y={Y(v)} dy="0.32em" textAnchor="end">{compact(v)}</text>
            </g>
          ))}
          {data.map(bar)}
          {data.map((d, i) => (i % every === 0 || data.length <= 3) && (
            <text key={d.key} className="axis" x={m.l + band * (i + 0.5)} y={height - 6} textAnchor="middle">{d.label}</text>
          ))}
          {/* Zonas de puntero: toda la banda, más grande que la marca. */}
          {data.map((d, i) => (
            <rect key={d.key} x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent"
              onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)} />
          ))}
        </svg>
        {hd && <Tip x={m.l + band * (hi + 0.5)} y={Y(Math.max(0, hd.v)) - 50} w={w}>{tip(hd)}</Tip>}
      </>
    );
  }
  return (
    <div className="chart" ref={ref} style={{ height }} {...keys.props}>
      {body}{keys.hint}
      <Say>{keys.kbd && tip(data[hi])}</Say>
    </div>
  );
}

/**
 * Columnas enfrentadas: lo que entra hacia arriba y lo que sale hacia abajo, por periodo.
 * data: [{ key, label, up, down }] (los dos en positivo). tip: (dato) => contenido.
 */
export function Diverge({ data, height = 220, tip, label }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const keys = useChartKeys(data.length, hi, setHi, label);
  const m = { l: 46, r: 6, t: 10, b: 24 };
  let body = null;
  if (w > 0 && data.length) {
    const iw = w - m.l - m.r, ih = height - m.t - m.b;
    const yt = ticks(-Math.max(1, ...data.map((d) => d.down)), Math.max(1, ...data.map((d) => d.up)));
    const y0 = yt[0], y1 = yt.at(-1);
    const Y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
    const band = iw / data.length;
    const bw = Math.max(2, Math.min(22, band - 3));
    const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 52)));
    // Extremo redondeado hacia fuera del eje, base recta en el cero.
    const bar = (x, v, cls) => {
      const h = Math.abs(Y(v) - Y(0));
      if (h < 0.5) return null;
      const r = Math.min(4, bw / 2, h);
      const d = v > 0
        ? `M${x},${Y(0)}V${Y(v) + r}Q${x},${Y(v)} ${x + r},${Y(v)}H${x + bw - r}Q${x + bw},${Y(v)} ${x + bw},${Y(v) + r}V${Y(0)}Z`
        : `M${x},${Y(0)}V${Y(v) - r}Q${x},${Y(v)} ${x + r},${Y(v)}H${x + bw - r}Q${x + bw},${Y(v)} ${x + bw},${Y(v) - r}V${Y(0)}Z`;
      return <path d={d} className={`bar ${cls}`} />;
    };
    const hd = hi != null && data[hi];
    body = (
      <>
        <svg width={w} height={height} aria-hidden="true" onPointerLeave={() => setHi(null)}>
          {yt.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'base' : 'grid'} x1={m.l} x2={w - m.r} y1={Y(v)} y2={Y(v)} />
              <text className="axis" x={m.l - 8} y={Y(v)} dy="0.32em" textAnchor="end">{compact(v)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = m.l + band * i + (band - bw) / 2;
            return <g key={d.key} className={hi === i ? 'hi' : ''}>{bar(x, d.up, 'up')}{bar(x, -d.down, 'down')}</g>;
          })}
          {data.map((d, i) => (i % every === 0 || data.length <= 3) && (
            <text key={d.key} className="axis" x={m.l + band * (i + 0.5)} y={height - 6} textAnchor="middle">{d.label}</text>
          ))}
          {data.map((d, i) => (
            <rect key={d.key} x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent"
              onPointerEnter={() => setHi(i)} onPointerDown={() => setHi(i)} />
          ))}
        </svg>
        {hd && <Tip x={m.l + band * (hi + 0.5)} y={Y(hd.up) - 60} w={w}>{tip(hd)}</Tip>}
      </>
    );
  }
  return (
    <div className="chart" ref={ref} style={{ height }} {...keys.props}>
      {body}{keys.hint}
      <Say>{keys.kbd && tip(data[hi])}</Say>
    </div>
  );
}

/** Ranking horizontal: etiqueta, barra proporcional y valor. rows: [{ label, w, right, sub, onClick }] */
export function RankBars({ rows }) {
  const max = Math.max(...rows.map((r) => r.w), 1);
  return (
    <div className="rank">
      {rows.map((r) => {
        const Tag = r.onClick ? 'button' : 'div';
        return (
          <Tag key={r.key ?? r.label} className="rank-row" onClick={r.onClick} type={r.onClick ? 'button' : undefined}>
            <span className="rank-l" title={r.label}>{r.label}</span>
            <span className="rank-t"><span className={`rank-b ${r.other ? 'other' : ''}`} style={{ width: `${(r.w / max) * 100}%` }} /></span>
            <span className="rank-v">{r.right}{r.sub && <small>{r.sub}</small>}</span>
          </Tag>
        );
      })}
    </div>
  );
}

/**
 * Líneas sobre un eje de tiempo común (mismas unidades). Sin ejes ni rejilla: el valor
 * se lee con el cursor, que además avisa por onHover(índice | null).
 * x: ms[]; series: [{ key, values[], cls, step, area }]; tip: (índice) => contenido.
 */
export function Lines({ x, series, height = 280, tip, label, onHover, base, marks = [] }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const keys = useChartKeys(x.length, hi, (i) => { setHi(i); onHover?.(i); }, label);
  const m = { t: 14, b: 26 };
  let body = null;
  if (w > 0 && x.length > 1) {
    const ih = height - m.t - m.b;
    let lo = base ?? Infinity, top = base ?? -Infinity;
    for (const s of series) for (const v of s.values) if (v != null) { if (v < lo) lo = v; if (v > top) top = v; }
    const pad = (top - lo) * 0.08 || 1;
    lo -= pad * 0.4; top += pad;
    const t0 = x[0], t1 = x.at(-1);
    const X = (t) => ((t - t0) / (t1 - t0 || 1)) * w;
    const Y = (v) => m.t + ih - ((v - lo) / (top - lo)) * ih;
    const path = (s) => {
      let d = '', pen = false;
      for (const i of decimate(s.values.length, (k) => s.values[k], (k) => X(x[k]))) {
        const v = s.values[i];
        if (v == null) { pen = false; continue; }
        const px = X(x[i]).toFixed(1), py = Y(v).toFixed(1);
        d += pen ? (s.step ? `H${px}V${py}` : `L${px},${py}`) : `M${px},${py}`;
        pen = true;
      }
      return d;
    };
    // Las marcas pegadas a los bordes se cortarían: fuera.
    const xt = timeTicks(t0, t1, w).filter((k) => X(k.t) > 28 && X(k.t) < w - 28);
    const move = (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      const t = t0 + ((ev.clientX - r.left) / w) * (t1 - t0);
      let lo2 = 0, hi2 = x.length - 1;
      while (lo2 < hi2) { const mid = (lo2 + hi2 + 1) >> 1; if (x[mid] <= t) lo2 = mid; else hi2 = mid - 1; }
      if (lo2 !== hi) { setHi(lo2); onHover?.(lo2); }
    };
    const leave = () => { setHi(null); onHover?.(null); };
    const main = series[0];
    const d0 = path(main);
    body = (
      <>
        <svg width={w} height={height} aria-hidden="true" onPointerMove={move} onPointerDown={move} onPointerLeave={leave}>
          {main.area && (
            <>
              <defs>
                <linearGradient id="lines-fade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
                  <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path className={`fade ${main.cls}`} fill="url(#lines-fade)" d={`${d0}V${m.t + ih}H${X(x[main.values.findIndex((v) => v != null)])}Z`} />
            </>
          )}
          {base != null && <line className="base dotted" x1={0} x2={w} y1={Y(base)} y2={Y(base)} />}
          {xt.map((k) => <text key={k.t} className="axis" x={X(k.t)} y={height - 6} textAnchor="middle">{k.s}</text>)}
          {[...series].reverse().map((s) => <path key={s.key} className={`ln ${s.cls}`} d={s === main ? d0 : path(s)} />)}
          {marks.map((k) => main.values[k.i] != null && (
            <circle key={k.key} className={`mk ${k.cls}`} cx={X(x[k.i])} cy={Y(main.values[k.i])} r="5" />
          ))}
          {hi != null && (
            <>
              <line className="cross" x1={X(x[hi])} x2={X(x[hi])} y1={m.t} y2={m.t + ih} />
              {series.map((s) => s.values[hi] != null && <circle key={s.key} className={`pt ${s.cls}`} cx={X(x[hi])} cy={Y(s.values[hi])} r="4.5" />)}
            </>
          )}
        </svg>
        {hi != null && tip && <Tip x={X(x[hi])} y={2} w={w}>{tip(hi)}</Tip>}
      </>
    );
  }
  return (
    <div className="chart" ref={ref} style={{ height }} {...keys.props}>
      {body}{keys.hint}
      <Say>{keys.kbd && tip?.(hi)}</Say>
    </div>
  );
}

/** Reparto "squarified": rectángulos lo más cuadrados posible, de mayor a menor. */
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((t, i) => t + i.v, 0);
  let rest = items.map((i) => ({ ...i, a: (i.v / total) * w * h }));
  while (rest.length) {
    const short = Math.min(w, h);
    let row = [], best = Infinity, sum = 0;
    for (const it of rest) {
      const s2 = sum + it.a;
      const worst = Math.max(...[...row, it].map((r) => Math.max((short * short * r.a) / (s2 * s2), (s2 * s2) / (short * short * r.a))));
      if (worst > best) break;
      row.push(it); sum = s2; best = worst;
    }
    const thick = sum / short;
    let off = 0;
    for (const r of row) {
      const len = r.a / thick;
      out.push(w >= h ? { ...r, x, y: y + off, w: thick, h: len } : { ...r, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    rest = rest.slice(row.length);
  }
  return out;
}

/**
 * Mapa de bloques: el área es el peso y el color, la rentabilidad (verde/rojo, gris en cero).
 * items: [{ key, label, v, w, plp, onClick }]
 */
export function Treemap({ items, height = 320, cap = 30 }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const tiles = w > 0 ? squarify(items.filter((i) => i.v > 0), 0, 0, w, height) : [];
  const tone = (p) => {
    const k = Math.min(1, Math.abs(p) / cap);
    return `color-mix(in srgb, var(${p >= 0 ? '--gain' : '--loss'}) ${Math.round(16 + k * 44)}%, var(--surface-2))`;
  };
  const hd = hi != null && tiles[hi];
  return (
    <div className="chart tree" ref={ref} style={{ height }} onPointerLeave={() => setHi(null)}>
      {tiles.map((t, i) => {
        const Tag = t.onClick ? 'button' : 'div';
        const big = t.w > 74 && t.h > 40;
        return (
          <Tag key={t.key} type={t.onClick ? 'button' : undefined} role={t.onClick ? undefined : 'img'} className="tile" onClick={t.onClick}
            onPointerEnter={() => setHi(i)} aria-label={`${t.label}: ${t.w2}`}
            style={{ left: t.x + 1, top: t.y + 1, width: Math.max(0, t.w - 2), height: Math.max(0, t.h - 2), background: tone(t.plp) }}>
            {big && <b>{t.label}</b>}
            {big && t.h > 58 && <span>{t.right}</span>}
          </Tag>
        );
      })}
      {hd && <Tip x={hd.x + hd.w / 2} y={Math.max(0, hd.y - 8)} w={w}><small>{hd.label}</small><b>{hd.right}</b><small>{hd.sub}</small></Tip>}
    </div>
  );
}
