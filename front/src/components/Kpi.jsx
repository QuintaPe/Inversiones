import { sign } from '../lib/format.js';
// Indicadores compactos con mini-gráfica (Resumen, Efectivo…).

/** Mini-gráfica sin ejes: línea (values) o barras (bars). */
export const Spark = ({ values, bars, tone = '' }) => {
  const w = 120, hgt = 34, vs = bars ?? values ?? [];
  if (vs.length < 2) return null;
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (bars) lo = Math.min(0, lo);
  const Y = (v) => hgt - 2 - ((v - lo) / (hi - lo || 1)) * (hgt - 4);
  if (bars) {
    const bw = w / vs.length;
    return (
      <svg className="spark" viewBox={`0 0 ${w} ${hgt}`} preserveAspectRatio="none" aria-hidden="true">
        {vs.map((v, i) => <rect key={i} x={i * bw + 1} y={Y(v)} width={Math.max(1, bw - 2)} height={Math.max(1, hgt - 2 - Y(v))} rx="1.5" />)}
      </svg>
    );
  }
  const d = vs.map((v, i) => `${i ? 'L' : 'M'}${((i / (vs.length - 1)) * w).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  return (
    <svg className={`spark ${tone}`} viewBox={`0 0 ${w} ${hgt}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-a" d={`${d}L${w},${hgt}L0,${hgt}Z`} />
      <path className="spark-l" d={d} />
    </svg>
  );
};
/**
 * Comparación en barras horizontales sobre una escala común: rows [{ label, v, text, cls }].
 * Con algún valor negativo, el cero va al centro y las pérdidas crecen hacia la izquierda.
 */
export const VsBars = ({ rows }) => {
  const max = Math.max(...rows.map((r) => Math.abs(r.v)), 1e-9);
  const neg = rows.some((r) => r.v < 0);
  const zero = neg ? 50 : 0, span = neg ? 50 : 100;
  return (
    <div className="vs" aria-hidden="true">
      {rows.map((r) => {
        const w = (Math.abs(r.v) / max) * span;
        return (
          <div key={r.label} className="vs-r">
            <span className="vs-l">{r.label}</span>
            <span className="vs-t">
              {neg && <i className="vs-0" />}
              <span className={`vs-b ${r.cls ?? ''} ${r.v < 0 ? 'neg' : ''}`} style={{ left: `${r.v < 0 ? zero - w : zero}%`, width: `${Math.max(w, 1.5)}%` }} />
            </span>
            <b className={`vs-v ${sign(r.v)}`}>{r.text}</b>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Indicador compacto: cifra, explicación y mini-gráfica; lleva a su sección.
 * Con `body` el contenido es libre (y la tarjeta no es un botón: lo que lleva dentro sí lo es).
 */
export const Kpi = ({ label, value, sub, tone = '', spark, onClick, body }) => {
  const Tag = onClick && !body ? 'button' : 'div';
  return (
    <Tag className={`kpi ${body ? 'kpi-free' : ''}`} type={Tag === 'button' ? 'button' : undefined} onClick={body ? undefined : onClick}>
      <span className="kpi-l">{label}</span>
      {body ?? (
        <>
          <b className={`kpi-v ${tone}`}>{value}</b>
          {sub && <small className="kpi-s">{sub}</small>}
          {spark}
        </>
      )}
    </Tag>
  );
};
