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
/** Indicador compacto: cifra, explicación y mini-gráfica; lleva a su sección. */
export const Kpi = ({ label, value, sub, tone = '', spark, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="kpi" type={onClick ? 'button' : undefined} onClick={onClick}>
      <span className="kpi-l">{label}</span>
      <b className={`kpi-v ${tone}`}>{value}</b>
      {sub && <small className="kpi-s">{sub}</small>}
      {spark}
    </Tag>
  );
};
