import { useState } from 'react';
import { useWidth } from './hooks.js';
import { compact } from './lib/format.js';


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
    let d = `M${X(points[0].t)},${Y(points[0].v)}`;
    for (let i = 1; i < points.length; i++) d += `H${X(points[i].t)}V${Y(points[i].v)}`;
    // Marcas del eje X: inicio de mes, espaciadas para que quepan.
    const xt = [];
    const start = new Date(t0), end = new Date(t1);
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
    const every = Math.max(1, Math.ceil(months / Math.max(2, Math.floor(iw / 70))));
    for (let i = 1; i <= months; i += every) {
      const dt = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1);
      xt.push({ t: dt, s: new Date(dt).toLocaleDateString('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
    }
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
        <svg width={w} height={height} role="img" aria-label={label}
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
  return <div className="chart" ref={ref} style={{ height }}>{body}</div>;
}

/**
 * Columnas (una serie; admite valores negativos, que se pintan como pérdida).
 * data: [{ key, label, v }]. tip: (dato) => contenido.
 */
export function Columns({ data, height = 200, tip, label, signed = false }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
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
        <svg width={w} height={height} role="img" aria-label={label} onPointerLeave={() => setHi(null)}>
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
  return <div className="chart" ref={ref} style={{ height }}>{body}</div>;
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
export function Lines({ x, series, height = 280, tip, label, onHover, base }) {
  const [ref, w] = useWidth();
  const [hi, setHi] = useState(null);
  const m = { t: 14, b: 26 };
  let body = null;
  if (w > 0 && x.length > 1) {
    const ih = height - m.t - m.b;
    const all = series.flatMap((s) => s.values).filter((v) => v != null);
    let lo = Math.min(...all, base ?? Infinity), top = Math.max(...all, base ?? -Infinity);
    const pad = (top - lo) * 0.08 || 1;
    lo -= pad * 0.4; top += pad;
    const t0 = x[0], t1 = x.at(-1);
    const X = (t) => ((t - t0) / (t1 - t0 || 1)) * w;
    const Y = (v) => m.t + ih - ((v - lo) / (top - lo)) * ih;
    const path = (s) => {
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const px = X(x[i]).toFixed(1), py = Y(v).toFixed(1);
        d += pen ? (s.step ? `H${px}V${py}` : `L${px},${py}`) : `M${px},${py}`;
        pen = true;
      });
      return d;
    };
    const months = Math.round((t1 - t0) / (30.44 * 86400000));
    const start = new Date(t0);
    const every = Math.max(1, Math.ceil(months / Math.max(2, Math.floor(w / 80))));
    const xt = [];
    for (let i = 1; i <= months; i += every) {
      const dt = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1);
      if (X(dt) > 28 && X(dt) < w - 28) xt.push({ t: dt, s: new Date(dt).toLocaleDateString('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' }) });
    }
    // Periodos cortos: se rotulan días en vez de meses.
    if (!xt.length) {
      const n = Math.max(2, Math.floor(w / 90));
      for (let k = 1; k < n; k++) {
        const t = t0 + ((t1 - t0) * k) / n;
        xt.push({ t, s: new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }) });
      }
    }
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
        <svg width={w} height={height} role="img" aria-label={label} onPointerMove={move} onPointerDown={move} onPointerLeave={leave}>
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
  return <div className="chart" ref={ref} style={{ height }}>{body}</div>;
}
