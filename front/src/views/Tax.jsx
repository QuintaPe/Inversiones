import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Icon, Seg, Sticky, Tabs } from '../components/ui.jsx';
import { Columns } from '../charts.jsx';
import SaleSim from './SaleSim.jsx';
import { useParam } from '../router.js';
import { taxYears, yearEnd, divFiscal, saleGroup, TREATY_RATE, savingsBrackets } from '../../../shared/calc.js';
import { country } from '../lib/countries.js';
import { eur, eurS, num, qty, sign, date, pct, isMasked, compact } from '../lib/format.js';

/** Ventas y dividendos del ejercicio en un CSV listo para trasladar a la declaración. */
function exportYear(y) {
  const n = (v) => String(+v.toFixed(2)).replace('.', ',');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [
    ['tipo', 'fecha', 'valor', 'isin', 'pais', 'cantidad', 'valor_transmision', 'valor_adquisicion', 'resultado', 'fechas_adquisicion', 'dividendo_bruto', 'retencion', 'retencion_espana', 'retencion_origen'].join(';'),
    ...y.sales.map((x) => ['venta', x.d, q(x.p.name), x.p.isin, q(country(x.p.isin)), String(+x.sh.toFixed(6)).replace('.', ','), n(x.net), n(x.csF), n(x.reF),
      q([...new Set(x.lotsUsed.map((l) => l.d))].join(' ')), '', '', '', ''].join(';')),
    ...y.divs.map((x) => {
      const f = divFiscal(x);
      return ['dividendo', x.d, q(x.p.name), x.p.isin, q(country(x.p.isin)), String(+(x.sh ?? 0).toFixed(6)).replace('.', ','), '', '', '', '', n(f.g), n(f.tax), n(f.es), n(f.foreign)].join(';');
    }),
  ];
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  el.download = `fiscalidad-${y.year}.csv`;
  el.click();
  URL.revokeObjectURL(el.href);
}

const STATUS = {
  auto: ['check', 'Ya está en Renta Web'],
  manual: ['plus', 'Dar de alta en Renta Web'],
};

/** Importe, fecha o nombre que se copia al pulsarlo, tal cual se teclea en Renta Web. */
function CopyValue({ k, v, copy, copied }) {
  const text = typeof v === 'number' ? eur(v) : v;
  return (
    <button type="button" className="rw-v" disabled={isMasked() && typeof v === 'number'} onClick={() => copy(k, v)}
      aria-label={`Copiar ${text}`} title="Copiar">
      <span>{text}</span><Icon name={copied === k ? 'check' : 'copy'} size={14} />
    </button>
  );
}

/**
 * Una ventana de Renta Web: una fila por registro (alta) con sus campos, como el «Resumen de los
 * rendimientos» del programa. En móvil cada registro pasa a ser una lista de campo → importe.
 */
function RentaForm({ id, box, title, intro, fields, records, help, copy, copied }) {
  // Los importes se suman; las fechas y los nombres (texto) se copian tal cual.
  const num = fields.map((_, i) => records.every((r) => typeof r.values[i] === 'number'));
  const total = fields.map((_, i) => (num[i] ? records.reduce((t, r) => t + r.values[i], 0) : null));
  return (
    <section className="card rw" id={`rw-${id}`} aria-labelledby={`rw-${id}-h`}>
      <header className="rw-h">
        {box && <span className="rw-box">{box}</span>}
        <h3 id={`rw-${id}-h`}>{title}</h3>
      </header>
      {intro && <p className="rw-intro">{intro}</p>}
      <table className="rw-t" style={{ '--rw-n': fields.length }}>
        <thead>
          <tr><th scope="col">Registro</th>{fields.map((f) => <th key={f} scope="col">{f}</th>)}</tr>
        </thead>
        <tbody>
          {records.map((r, ri) => (
            <tr key={ri} className={r.status === 'manual' ? 'is-manual' : ''}>
              <th scope="row" className="rw-rec">
                <span className="rw-rec-l">{r.label}</span>
                {r.status && (
                  <span className={`rw-tag ${r.status}`}><Icon name={STATUS[r.status][0]} size={12} />{STATUS[r.status][1]}</span>
                )}
                {r.sub && <small>{r.sub}</small>}
              </th>
              {fields.map((f, fi) => (
                <td key={f} data-label={f}><CopyValue k={`${id}-${ri}-${fi}`} v={r.values[fi]} copy={copy} copied={copied} /></td>
              ))}
            </tr>
          ))}
        </tbody>
        {records.length > 1 && num.some(Boolean) && (
          <tfoot>
            <tr>
              <th scope="row">Total en Renta Web</th>
              {fields.map((f, i) => <td key={f} data-label={f}>{num[i] ? <b>{eur(total[i])}</b> : null}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
      {help?.length > 0 && (
        <details className="rw-more">
          <summary>Qué va en cada campo</summary>
          <dl>{help.map(([dt, dd]) => <div key={dt}><dt>{dt}</dt><dd>{dd}</dd></div>)}</dl>
        </details>
      )}
    </section>
  );
}

const GROUP_LABEL = { iic: 'Fondo o ETF', other: 'Otros elementos', crypto: 'Moneda virtual', pm: 'Private Markets' };

export default function Tax({ a, income, onOpen, settings }) {
  const years = useMemo(() => taxYears(a.sl, a.dv, income), [a.sl, a.dv, income]);
  const [sel, setSel] = useParam('ejercicio', null);
  const [tab, setTab] = useParam('ver', 'resumen', { resumen: 'resumen', ventas: 'ventas', dividendos: 'dividendos', renta: 'renta', simular: 'simular' });
  const [steps, setSteps] = useState(false);
  // Antes de fin de año: qué pasaría en la declaración al vender hoy cada posición.
  const plan = useMemo(() => yearEnd(a.o, a.sl, a.dv, income), [a.o, a.sl, a.dv, income]);
  const [copied, setCopied] = useState(null);
  // Fuera de la pestaña elegida no se ven, pero siguen ahí para el informe en PDF.
  const pane = (k) => `stack tax-pane ${tab === k ? '' : 'off'}`;
  const copy = (label, v) => {
    navigator.clipboard?.writeText(typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1400);
    }).catch(() => {});
  };
  if (!years.length) return <div className="card"><Empty>Todavía no hay ventas, dividendos ni intereses que declarar.</Empty></div>;
  const y = years.find((r) => r.year === sel) ?? years[0];
  const diff = y.gainF - y.gainAvg;
  // Base del ahorro orientativa: ganancias netas más rendimientos, con la compensación de pérdidas ya aplicada.
  const base = y.base;
  const quota = y.quota, due = y.due;
  const lost = y.gainTax - y.usedPrev < 0; // el año cierra con pérdidas patrimoniales
  const byCountry = Object.values(y.countries).map((r) => ({ ...r, c: country(r.isin) })).sort((p, q) => q.g - p.g);
  // Composición de la base y tramos que se ven (hasta el siguiente al de tu base).
  const gainsNet = Math.max(0, y.gainTax - y.usedPrev);
  const parts = [
    ['gain', 'Ganancias por ventas', gainsNet], ['div', 'Dividendos', y.divG],
    ['int', 'Intereses', y.intG ?? 0], ['rew', 'Saveback y bonus', y.rewG ?? 0],
  ].filter(([, , v]) => v >= 0.005).map(([k, label, v]) => ({ k, label, v }));
  let prev = 0;
  const ranges = savingsBrackets(y.year).map(([top, rate]) => { const r = [prev, top, rate]; prev = top; return r; });
  const cur = Math.max(0, ranges.findIndex(([, to]) => base <= to));
  const shown = ranges.slice(0, Math.min(ranges.length, Math.max(2, cur + 2))).map(([f, t, r]) => [f, t === Infinity ? Math.max(f * 1.5, base) : t, r]);
  const marginal = ranges[cur][2];
  // Lo que se traslada a Renta Web, agrupado como el informe fiscal de Trade Republic, con las
  // casillas del modelo 100 de 2025 comprobadas en su diseño oficial.
  // Desde `since` informa a Hacienda la sucursal española de Trade Republic: lo anterior (y lo que
  // no lleva retención española) no está en los datos fiscales y se da de alta a mano.
  const g = y.groups ?? {};
  // El día del traspaso viene del CSV (filas MIGRATION); sin él, el primer rendimiento con retención española.
  const since = settings?.migrated ?? [y.incSince, y.divSince].filter(Boolean).sort()[0] ?? null;
  const split = (g0, t0, pre, from, manualLabel, manualSub) => {
    if (!(pre.g >= 0.005) || !from) return [{ label: 'Trade Republic', values: [g0, t0, 0] }];
    return [
      { label: 'Sucursal española', status: 'auto', sub: `Desde el ${date(from)}`, values: [g0 - pre.g, t0 - pre.t, 0] },
      { label: manualLabel ?? 'Sucursal alemana', status: 'manual', sub: `${pre.n} ${pre.n === 1 ? 'cobro' : 'cobros'} ${manualSub ?? `anteriores al ${date(from)}`}`, values: [pre.g, pre.t, 0] },
    ];
  };
  const fields = ['Ingresos íntegros', 'Retenciones', 'Gastos'];
  const gastos = ['Gastos', 'Siempre 0. Solo cuentan comisiones de custodia o administración de valores, y Trade Republic no cobra ninguna.'];
  const forms = [
    y.intN + y.rewN > 0 && {
      id: 'int', box: '0027', short: 'Intereses, Saveback y bonus', title: 'Intereses de cuentas, depósitos y activos financieros', fields,
      intro: 'Intereses, Saveback y bonus van juntos: tributan el año en que los cobras.',
      records: split(y.intG + y.rewG, y.intT + y.rewT, y.incPre, y.incSince),
      help: [
        ['Ingresos íntegros', <>Lo cobrado antes de retenciones: {eur(y.intG)} de intereses y {eur(y.rewG)} de Saveback y bonus. Lo que compras
          con el Saveback entra a ese mismo valor, así que al venderlo solo tributa lo que haya subido.</>],
        ['Retenciones', 'El 19 % que Trade Republic ya ingresó en Hacienda por ti. Se descuenta de lo que pagas.'],
        gastos,
        ['Dos registros', 'Lo de la sucursal española ya viene en tus datos fiscales. Lo anterior se añade con «Alta Capital mobiliario».'],
      ],
    },
    y.divs.length > 0 && {
      id: 'div', box: '0029', short: 'Dividendos', title: 'Dividendos y similares', fields,
      intro: 'Los dividendos de todas tus acciones, españolas y extranjeras, por su importe bruto.',
      records: split(y.divG, y.divEs, y.divPre, y.divSince, 'Sin retención española', 'sin retención española'),
      help: [
        ['Ingresos íntegros', <>El dividendo bruto, antes de cualquier retención, también la del país de origen.
          {y.grossedN > 0 && <> {y.grossedN} de tus cobros llegan en el CSV ya sin la retención extranjera: aquí se suma, como hace el informe de Trade Republic.</>}</>],
        ['Retenciones', <>Solo lo retenido en España. Lo que retuvo el país de origen ({eur(y.divFor)}) no va aquí: se recupera con la
          deducción por doble imposición (0588).</>],
        gastos,
        ['Sin retención española', 'Los cobrados con la sucursal alemana (están en su informe fiscal) y los de los días del cambio, que no salen en ningún informe pero también se declaran.'],
      ],
    },
    y.forRcm + y.forGains >= 0.005 && {
      id: 'ddi', box: '0588', short: 'Doble imposición', title: 'Deducción por doble imposición internacional',
      lead: y.dii, // la casilla 0588 es la deducción, no los datos con los que se calcula
      fields: ['Rendimientos del extranjero', 'Ganancias del extranjero', 'Impuesto pagado fuera'],
      intro: <>Renta Web calcula la deducción con estos tres datos: lo menor entre lo pagado fuera y lo que pagarías aquí por esas rentas. Con tus cifras, {eur(y.dii)}.</>,
      records: [{ label: 'Valores extranjeros', values: [y.forRcm, y.forGains, y.forDed] }],
      help: [
        ['Rendimientos del extranjero', 'Rendimientos netos reducidos del capital mobiliario obtenidos en el extranjero: los dividendos brutos de empresas no españolas.'],
        ['Ganancias del extranjero', 'Ganancias patrimoniales obtenidas en el extranjero: el resultado neto de vender valores de emisores no españoles (0 si es negativo). Las criptomonedas no cuentan: no tienen país.'],
        ['Impuesto pagado fuera', <>Impuesto satisfecho en el extranjero que se puede deducir: hasta el {TREATY_RATE * 100} % del bruto en los países con
          convenio, y nada en Dinamarca, que no tiene convenio con España.
          {y.forExcess >= 0.5 && <> Los {eur(y.forExcess)} retenidos por encima de ese límite no se deducen; en los países con convenio se pueden reclamar a su hacienda.</>}</>],
      ],
    },
  ].filter(Boolean);

  // Ventas. Acciones, fondos y Private Markets van por entidad emisora: aquí, los totales de lo que
  // ya informó la sucursal española y de lo que se añade a mano. Otros elementos y monedas virtuales
  // se dan de alta venta a venta (en otros elementos, cada lote con su fecha de compra).
  const sold = (k) => [...y.sales].filter((x) => saleGroup(x.p) === k).reverse();
  const isManual = (x) => since != null && x.d < since;
  const groupRecs = (k) => {
    const all = sold(k);
    const part = (list, status, label) => {
      if (!list.length) return null;
      const ent = [...new Set(list.map((x) => x.p.name))];
      return {
        label, status, sub: status === 'manual' ? ent.join(', ') : `${ent.length} ${ent.length === 1 ? 'entidad' : 'entidades'}, ${list.length} ${list.length === 1 ? 'venta' : 'ventas'}`,
        values: [list.reduce((t, x) => t + x.net, 0), list.reduce((t, x) => t + x.csF, 0), list.reduce((t, x) => t + x.reF, 0)],
      };
    };
    if (since == null) return [part(all, null, 'Todas las ventas')].filter(Boolean);
    return [part(all.filter((x) => !isManual(x)), 'auto', 'Sucursal española'), part(all.filter(isManual), 'manual', 'Sucursal alemana')].filter(Boolean);
  };
  const result = 'Resultado';
  const lotRecs = sold('other').flatMap((x) => {
    const lots = {};
    for (const l of x.lotsUsed ?? []) { const o = (lots[l.d] ??= { sh: 0, cost: 0 }); o.sh += l.sh; o.cost += l.sh * l.unit; }
    return Object.entries(lots).map(([d, l]) => ({
      label: x.p.name, sub: `${x.p.isin} · resultado ${eurS(x.net * (l.sh / x.sh) - l.cost)}`, status: since ? (isManual(x) ? 'manual' : 'auto') : null,
      values: [date(x.d), date(d), x.net * (l.sh / x.sh), l.cost],
    }));
  });
  const cryptoRecs = sold('crypto').map((x) => ({
    label: `Venta del ${date(x.d)}`, sub: `Resultado ${eurS(x.reF)}`, status: since ? (isManual(x) ? 'manual' : 'auto') : null,
    values: [x.p.name, x.net, x.csF],
  }));
  const comision = ['Comisiones', 'La transmisión va sin la comisión de venta y la adquisición con la de compra. El informe de Trade Republic da la transmisión sin descontar la comisión y la pone aparte: sale 1 € más por venta, con la misma ganancia.'];
  const saleForms = [
    g.stock && {
      id: 'stock', box: '0326–0340', key: '0328', short: 'Acciones', title: 'Transmisión de acciones negociadas', records: groupRecs('stock'),
      fields: ['0328 · Transmisión', '0331 · Adquisición', result],
      intro: 'Una alta por entidad emisora, con la suma de sus ventas del año. El desglose está en «Ventas».',
      help: [
        ['0327 · Denominación', 'El nombre de la entidad emisora (Adidas, Alphabet…).'],
        ['0328 y 0331', 'Lo cobrado y lo pagado por las acciones de esa entidad vendidas en el año, por FIFO.'],
        ['Resultado', 'No se teclea: Renta Web lo calcula (0332 si es ganancia, 0337 si es pérdida).'],
        comision,
      ],
    },
    g.iic && {
      id: 'iic', box: '0310–0325', key: '0312', short: 'Fondos y ETF', title: 'Transmisión de fondos y ETF', records: groupRecs('iic'),
      fields: ['0312 · Transmisión', '0315 · Adquisición', result],
      intro: 'Una alta por fondo o ETF, con su NIF en la 0311.',
      help: [['Resultado', 'No se teclea: Renta Web lo calcula (0316 si es ganancia, 0321 si es pérdida).'], comision],
    },
    lotRecs.length > 0 && {
      id: 'other', box: '1624–1654', key: '1633', short: 'Otros elementos', title: 'Transmisión de otros elementos patrimoniales', records: lotRecs,
      fields: ['1631 · Fecha de venta', '1632 · Fecha de compra', '1633 · Transmisión', '1637 · Adquisición'],
      intro: 'Warrants, certificados y ETC (como el oro físico). Cada venta es un alta.',
      help: [
        ['1626 · Tipo de elemento', 'Clave 4: otros elementos patrimoniales no afectos a actividades económicas.'],
        ['Tipo de operación', 'Transmisión intervivos onerosa (1612): es una venta.'],
        ['Resultado', 'No se teclea: Renta Web lo calcula (1640 si es ganancia, 1638 si es pérdida).'],
        ['Por qué aquí', 'Un ETC no es un fondo aunque cotice como un ETF: es un título de deuda. Un warrant tampoco es una acción.'],
        comision,
      ],
    },
    cryptoRecs.length > 0 && {
      id: 'crypto', box: '1800–1814', key: '1804', short: 'Criptomonedas', title: 'Transmisión de monedas virtuales', records: cryptoRecs,
      fields: ['1802 · Moneda', '1804 · Transmisión', '1806 · Adquisición'],
      intro: 'Una alta por cada venta de criptomonedas a cambio de euros.',
      help: [
        ['1803 · Contraprestación', 'Lo que recibiste a cambio: euros (moneda de curso legal).'],
        ['Resultado', 'No se teclea: Renta Web lo calcula (1809 si es ganancia, 1807 si es pérdida).'],
        comision,
      ],
    },
    g.pm && {
      id: 'pm', box: null, short: 'Private Markets', title: 'Private Markets (no cotiza)', records: groupRecs('pm'),
      fields: ['Transmisión', 'Adquisición', result],
      intro: 'No va con las acciones negociadas. Contrasta el apartado con el informe de Trade Republic.',
    },
    (Math.abs(y.deferred) >= 0.005 || y.usedPrev + y.offsetRcm >= 0.005) && {
      id: 'adj', box: null, short: 'Compensaciones', title: 'Compensaciones', fields: ['Importe'],
      intro: 'Ajustes sobre el resultado de las ventas.',
      records: [
        Math.abs(y.deferred) >= 0.005 && { label: 'Pérdidas no imputables por recompra de valores homogéneos', values: [-y.deferred] },
        y.usedPrev + y.offsetRcm >= 0.005 && { label: 'Pérdidas de este y otros ejercicios que se compensan', values: [y.usedPrev + y.offsetRcm] },
      ].filter(Boolean),
    },
  ].filter(Boolean);
  const allForms = [...forms, ...saleForms];
  const manualN = allForms.reduce((n, f) => n + f.records.filter((r) => r.status === 'manual').length, 0);
  // Índice: la cifra de la casilla (o, si no se indica, el primer importe de la ventana).
  const headline = (f) => {
    if (f.lead != null) return f.lead;
    const i = f.fields.findIndex((_, k) => f.records.every((r) => typeof r.values[k] === 'number'));
    return i < 0 ? null : f.records.reduce((t, r) => t + r.values[i], 0);
  };

  return (
    <div className="stack tax">
      <div className="toolbar">
        <Seg label="Ejercicio" options={years.map((r) => [r.year, r.year])} value={y.year} onChange={setSel} />
        <button type="button" className="btn" onClick={() => exportYear(y)}><Icon name="download" size={16} />Exportar {y.year}</button>
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="fiscalidad" size={16} />Informe en PDF</button>
      </div>
      <header className="print-h">
        <h1>Informe fiscal {y.year}</h1>
        <p>Generado el {date(new Date().toISOString())} a partir de tus operaciones. Orientativo: no es asesoramiento fiscal.</p>
      </header>
      <Sticky className="tax-tabs">
        <Tabs label="Apartado" value={tab} onChange={setTab} items={[['resumen', 'Resumen'], ['ventas', `Ventas · ${y.sales.length}`], ['dividendos', `Dividendos · ${y.divs.length}`], ['renta', 'Renta Web'], ['simular', 'Simular']]} />
      </Sticky>
      {tab === 'simular' && <SaleSim a={a} income={income} onOpen={onOpen} />}
      <div className={pane('resumen')}>
      <section className="card tax-hero">
        <div className="tax-top">
          <div>
            <span className="eyebrow">Ejercicio {y.year} · estimación</span>
            <div className={`tax-due ${due < 0 ? 'gain' : ''}`}>{eur(Math.abs(due))}</div>
            <p className="tax-due-l">{due >= 0 ? 'a pagar en la declaración, tras las retenciones' : 'a devolver en la declaración'}</p>
          </div>
          <dl className="tax-stats">
            <div><dt>Base del ahorro</dt><dd>{eur(base)}</dd></div>
            <div><dt>Cuota</dt><dd>{eur(quota)}</dd></div>
            <div><dt>Ya retenido</dt><dd>{eur(y.withheld + y.dii)}</dd></div>
          </dl>
        </div>

        {parts.length > 0 && (
          <div className="tax-viz">
            <div>
              <h3 className="kv-h">De dónde sale tu base</h3>
              <div className="stackbar" role="img" aria-label="Composición de la base del ahorro">
                {parts.map((x) => <i key={x.k} className={`sb-${x.k}`} style={{ flexGrow: x.v }} title={`${x.label}: ${eur(x.v)}`} />)}
              </div>
              <ul className="legend flat">
                {parts.map((x) => <li key={x.k}><i className={`dotk sb-${x.k}`} />{x.label} <b>{eur(x.v)}</b></li>)}
              </ul>
            </div>
            <div>
              <h3 className="kv-h">Tu tramo del ahorro</h3>
              <div className="brackets" role="img" aria-label={`Tramo marginal del ${Math.round(marginal * 100)} %`}>
                {shown.map(([from, to, rate]) => (
                  <span key={from} className={`br ${base > from ? 'on' : ''}`}>
                    <i style={{ width: `${Math.max(0, Math.min(1, (base - from) / (to - from))) * 100}%` }} />
                    <small>{Math.round(rate * 100)} %{to < Infinity ? ` hasta ${compact(to)}` : ''}</small>
                  </span>
                ))}
              </div>
              <p className="note">Pagas el {Math.round(marginal * 100)} % por el último euro y un {pct(y.avgRate * 100)} de media.</p>
            </div>
          </div>
        )}

        <button type="button" className="fold" aria-expanded={steps} onClick={() => setSteps((v) => !v)}>
          {steps ? 'Ocultar el cálculo' : 'Ver el cálculo paso a paso'}
        </button>
        <div className={steps ? 'tax-steps' : 'tax-steps folded'}>
        <div className="calc">
            <div><span>Ganancias y pérdidas de las ventas (FIFO)</span><b className={sign(y.gainF)}>{eurS(y.gainF)}</b></div>
            {Math.abs(y.deferred) >= 0.005 && <div><span>+ Pérdidas diferidas por la regla de los dos meses</span><b>{eurS(-y.deferred)}</b></div>}
            {Math.abs(y.released) >= 0.005 && <div><span>− Pérdidas diferidas que afloran al vender lo recomprado</span><b>{eurS(y.released)}</b></div>}
            {y.usedPrev >= 0.005 && <div><span>− Pérdidas de años anteriores</span><b>−{eur(y.usedPrev)}</b></div>}
            <div className="t"><span>= Ganancias y pérdidas patrimoniales</span><b className={sign(y.gainTax - y.usedPrev)}>{eurS(y.gainTax - y.usedPrev)}</b></div>
            <div><span>Dividendos íntegros ({y.divs.length} cobros)</span><b>{eur(y.divG)}</b></div>
            {y.intN > 0 && <div><span>Intereses de la cuenta ({y.intN} abonos)</span><b>{eur(y.intG)}</b></div>}
            {y.rewN > 0 && <div><span>Saveback y bonus ({y.rewN} abonos)</span><b>{eur(y.rewG)}</b></div>}
            <div className="t"><span>= Rendimientos del capital mobiliario</span><b>{eur(y.rcm)}</b></div>
            {y.offsetRcm >= 0.005 && <div><span>− Pérdidas compensadas con rendimientos (máx. 25 %: {eur(0.25 * y.rcm)})</span><b>−{eur(y.offsetRcm)}</b></div>}
            <div className="t"><span>= Base del ahorro</span><b>{eur(base)}</b></div>
            <div><span>Cuota íntegra del ahorro (tipo medio {pct(y.avgRate * 100)})</span><b>{eur(quota)}</b></div>
            {y.dii >= 0.005 && <div><span>− Deducción por doble imposición internacional</span><b>−{eur(y.dii)}</b></div>}
            <div><span>− Retenciones practicadas en España (dividendos{y.intT > 0 ? ', intereses' : ''}{y.rewT > 0 ? ', premios' : ''})</span><b>−{eur(y.withheld)}</b></div>
            <div className="t"><span>= {due >= 0 ? 'A pagar' : 'A devolver'}</span><b>{eur(Math.abs(due))}</b></div>
            {y.carryOut >= 0.005 && <div><span>Pérdidas pendientes para los próximos ejercicios</span><b className="loss">−{eur(y.carryOut)}</b></div>}
          </div>
          <p className="note">
            {lost && <>Las pérdidas patrimoniales no restan directamente: compensan como mucho el 25 % de los rendimientos del año y el resto
              se guarda para los cuatro ejercicios siguientes. </>}
            Tramos del ahorro: 19 % hasta 6.000 €, 21 % hasta 50.000 €, 23 % hasta 200.000 €, 27 % hasta 300.000 € y 30 % en
            adelante. De la retención de cada dividendo se separa la parte española (a cuenta de la cuota) de la del país de
            origen, que se recupera con la deducción por doble imposición hasta el {TREATY_RATE * 100} % habitual de los convenios.
            No incluye rentas de fuera de esta cuenta, que cambiarían el tipo medio.
          </p>
        </div>
      </section>
      {y.year === plan.year && (plan.losses.length > 0 || plan.room >= 1) && (
        <Card className="no-print" title={`Antes de que acabe ${plan.year}`}
          sub={plan.losses.length
            ? 'Posiciones en pérdidas: lo que cambiaría tu declaración si las vendieras hoy'
            : 'Tienes pérdidas que aún pueden compensar ganancias'}>
          {plan.room >= 1 && (
            <p className="note">
              Puedes realizar hasta <b>{eur(plan.room)}</b> de ganancias este año sin pagar más: las absorben tus pérdidas
              {y.carryIn >= 0.005 ? ' (incluidas las pendientes de años anteriores)' : ''}.
            </p>
          )}
          {plan.losses.length > 0 && (
            <>
              <ul className="rows">
                {plan.losses.map(({ x, gain, saving, carried }) => (
                  <li key={x.p.isin}>
                    <button type="button" onClick={() => onOpen(x.p.isin)}>
                      <Asset p={x.p} size="sm">
                        Aflorarías {eurS(gain)}
                        {carried >= 0.005 && <> · {eur(carried)} quedarían pendientes para los próximos años</>}
                      </Asset>
                      <span className="row-r">
                        <span className={`row-v ${saving >= 0.005 ? 'gain' : ''}`}>{saving >= 0.005 ? `−${eur(saving)}` : eur(0)}</span>
                        <small>en tu cuota de {plan.year}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="note">
                Venta simulada de toda la posición al precio actual, por FIFO y con 1 € de comisión; no se suman entre sí.
                Para que la pérdida cuente no puedes recomprar el mismo valor en los dos meses siguientes
                (vendiendo hoy, hasta el {date(plan.noRebuyUntil)}). Vender solo por el impuesto cambia tu cartera: es
                una decisión de inversión, no solo fiscal.
              </p>
            </>
          )}
        </Card>
      )}
      {y.wash.length > 0 && (
        <Card title="Posible regla de los dos meses" sub={`${eurS(y.washLoss)} en pérdidas diferidas, descontadas del resultado del año`}>
          <ul className="rows">
            {y.wash.map(({ sale, buys, deferred }) => (
              <li key={sale.id}>
                <button type="button" onClick={() => onOpen(sale.p.isin)}>
                  <Asset p={sale.p} size="sm">Vendiste el {date(sale.d)} y compraste el {buys.map((b) => date(b.d)).join(', ')}</Asset>
                  <span className="row-r"><span className="row-v loss">{eurS(deferred)}</span>
                    {Math.abs(deferred - sale.reF) >= 0.005 && <small>de {eurS(sale.reF)}</small>}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="note">
            Si compras el mismo valor en los dos meses anteriores o posteriores a venderlo con pérdidas, esa pérdida se
            difiere, en la parte que corresponde a las acciones recompradas, hasta que las vendas. La estimación la
            descuenta este año y la recupera en el ejercicio en que vendes esas acciones. Es orientativo: revisa cada caso.
          </p>
        </Card>
      )}
      {years.filter((r) => r.sales.length).length > 1 && (
        <Card title="Resultado realizado por ejercicio" sub="Criterio FIFO">
          <Columns signed height={180} label="Resultado realizado por ejercicio"
            data={[...years].reverse().map((r) => ({ key: r.year, label: r.year, v: r.gainF, n: r.sales.length }))}
            tip={(d) => <><small>{d.label} · {d.n} ventas</small><b>{eurS(d.v)}</b></>} />
        </Card>
      )}
      <div className="card table-card">
        <header className="card-h"><div><h2>Resumen por ejercicio</h2></div></header>
        <table className="tbl">
          <thead><tr><th className="l">Ejercicio</th><th className="hide-s">Ventas</th><th className="hide-s">Transmisión</th>
            <th>Resultado FIFO</th><th className="hide-m">Con coste medio</th><th>Dividendos brutos</th><th className="hide-s">Retenciones</th></tr></thead>
          <tbody>
            {years.map((r) => (
              <tr key={r.year} onClick={() => setSel(r.year)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && setSel(r.year)}>
                <td className="l"><b>{r.year}</b></td><td className="hide-s">{r.sales.length || <span className="mu">—</span>}</td><td className="hide-s">{r.sales.length ? eur(r.proceeds) : <span className="mu">—</span>}</td>
                {/* Sin ventas no hay resultado: una raya, no un «+0,00 €». */}
                <td className={r.sales.length ? sign(r.gainF) : 'mu'}>{r.sales.length ? eurS(r.gainF) : '—'}</td>
                <td className={`hide-m ${r.sales.length ? sign(r.gainAvg) : 'mu'}`}>{r.sales.length ? eurS(r.gainAvg) : '—'}</td>
                <td>{eur(r.divG)}</td><td className="hide-s">{eur(r.divT)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      <div className={pane('ventas')}>
      <Card title={`Ganancias y pérdidas patrimoniales ${y.year}`} sub="Transmisiones del ejercicio, criterio FIFO">
        <div className="calc">
          <div><span>Valor de transmisión ({y.sales.length} ventas, neto de comisiones)</span><b>{eur(y.proceeds)}</b></div>
          <div><span>− Valor de adquisición (FIFO, con comisiones e impuestos)</span><b>−{eur(y.costF)}</b></div>
          <div className="t"><span>= Resultado</span><b className={sign(y.gainF)}>{eurS(y.gainF)}</b></div>
          <div><span>Ventas con ganancia</span><b className="gain">{eurS(y.wins)}</b></div>
          <div><span>Ventas con pérdida</span><b className={y.losses ? 'loss' : ''}>{y.losses ? eurS(y.losses) : eur(0)}</b></div>
        </div>
        {Math.abs(diff) >= 0.005 && (
          <p className="note">
            Con coste medio (el que usa el resto de la aplicación) el resultado sería {eurS(y.gainAvg)}: {eur(Math.abs(diff))}{' '}
            {diff > 0 ? 'menos' : 'más'}. La diferencia aparece cuando vendes parte de una posición comprada a varios precios.
          </p>
        )}
      </Card>

      <div className="card table-card">
        <header className="card-h"><div><h2>Ventas de {y.year}</h2><p>Cada venta con los lotes de compra que consume</p></div></header>
        {y.sales.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th className="l hide-s">Fecha</th><th className="l">Activo</th><th className="hide-s">Cantidad</th>
                <th className="hide-s">Transmisión</th><th className="hide-s">Adquisición</th><th>Resultado FIFO</th>
                <th className="hide-m l">Lotes consumidos</th>
              </tr>
            </thead>
            <tbody>
              {y.sales.map((x) => (
                <tr key={x.id} onClick={() => onOpen(x.p.isin)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(x.p.isin)}>
                  <td className="l nowrap hide-s">{date(x.d)}</td>
                  <td className="l"><Asset p={x.p} size="sm"><span className="only-s">{date(x.d)} · {qty(x.sh)} uds. · {eur(x.net)} − {eur(x.csF)}</span></Asset></td>
                  <td className="hide-s">{qty(x.sh)}</td>
                  <td className="hide-s">{eur(x.net)}</td>
                  <td className="hide-s">{eur(x.csF)}</td>
                  <td className={sign(x.reF)}>{eurS(x.reF)}</td>
                  <td className="hide-m l lots">{x.lotsUsed.map((l, i) => <span key={i}>{date(l.d)}: {qty(l.sh)} × {num(l.unit)}</span>)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td className="l hide-s">Total</td><td className="l"><span className="only-s">Total</span></td><td className="hide-s" /><td className="hide-s">{eur(y.proceeds)}</td>
                <td className="hide-s">{eur(y.costF)}</td><td className={sign(y.gainF)}>{eurS(y.gainF)}</td><td className="hide-m" /></tr>
            </tfoot>
          </table>
        ) : <Empty>Sin ventas en {y.year}.</Empty>}
      </div>
      {y.issuers.length > 0 && (
        <div className="card table-card">
          <header className="card-h"><div><h2>Ventas de {y.year} por entidad emisora</h2><p>Una línea por valor, como las pide Renta Web</p></div></header>
          <table className="tbl">
            <thead><tr><th className="l">Entidad</th><th className="l hide-s">ISIN</th><th className="hide-s">Ventas</th><th className="hide-s">Transmisión</th><th className="hide-s">Adquisición</th><th>Resultado</th></tr></thead>
            <tbody>
              {y.issuers.map((e) => (
                <tr key={e.p.isin} onClick={() => onOpen(e.p.isin)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e.p.isin)}>
                  <td className="l"><b>{e.p.name}</b>{e.grp !== 'stock' && <small className="mu"> · {GROUP_LABEL[e.grp]}</small>}
                    <small className="only-s">{eur(e.proceeds)} − {eur(e.cost)}</small></td>
                  <td className="l hide-s mono">{e.p.isin}</td><td className="hide-s">{e.n}</td>
                  <td className="hide-s">{eur(e.proceeds)}</td><td className="hide-s">{eur(e.cost)}</td><td className={sign(e.gain)}>{eurS(e.gain)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="l">Total<small className="only-s">{eur(y.proceeds)} − {eur(y.costF)}</small></td><td className="hide-s" /><td className="hide-s">{y.sales.length}</td><td className="hide-s">{eur(y.proceeds)}</td><td className="hide-s">{eur(y.costF)}</td><td className={sign(y.gainF)}>{eurS(y.gainF)}</td></tr></tfoot>
          </table>
        </div>
      )}
      </div>
      <div className={pane('dividendos')}>
      <Card title={`Dividendos ${y.year}`} sub="Rendimientos del capital mobiliario">
        <div className="calc">
          <div><span>Ingresos íntegros ({y.divs.length} cobros)</span><b>{eur(y.divG)}</b></div>
          <div><span>− Retención española (a cuenta del IRPF)</span><b>−{eur(y.divEs)}</b></div>
          <div><span>− Retención en el país de origen</span><b>−{eur(y.divFor)}</b></div>
          <div className="t"><span>= Neto cobrado</span><b>{eur(y.divG - y.divT)}</b></div>
          <div><span>Retención efectiva</span><b>{y.divG ? pct((y.divT / y.divG) * 100) : '—'}</b></div>
        </div>
      </Card>
      {byCountry.length > 0 && (
        <div className="card table-card">
          <header className="card-h"><div><h2>Dividendos de {y.year} por país</h2><p>Doble imposición internacional: qué se retuvo en origen y cuánto se puede deducir</p></div></header>
          <table className="tbl">
            <thead><tr><th className="l">País</th><th className="hide-s">Cobros</th><th>Bruto</th><th className="hide-s">Ret. española</th><th className="hide-s">Ret. en origen</th><th className="hide-s">% origen</th><th>Deducible</th></tr></thead>
            <tbody>
              {byCountry.map((r) => (
                <tr key={r.code} className="static">
                  <td className="l"><b>{r.c}</b><small className="only-s">retenido fuera {eur(r.foreign)}</small></td><td className="hide-s">{r.n}</td><td>{eur(r.g)}</td><td className="hide-s">{eur(r.es)}</td>
                  <td className="hide-s">{eur(r.foreign)}</td><td className="hide-s">{r.g ? pct((r.foreign / r.g) * 100) : '—'}</td><td>{eur(r.ded)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="l">Total<small className="only-s">retenido fuera {eur(y.divFor)}</small></td><td className="hide-s">{y.divs.length}</td><td>{eur(y.divG)}</td><td className="hide-s">{eur(y.divEs)}</td>
              <td className="hide-s">{eur(y.divFor)}</td><td className="hide-s">{y.divG ? pct((y.divFor / y.divG) * 100) : '—'}</td><td>{eur(y.forDed)}</td></tr></tfoot>
          </table>
          <p className="note pad">
            Deducible = lo retenido en origen, hasta el {TREATY_RATE * 100} % del bruto (el tipo de la mayoría de convenios). Con
            Dinamarca no hay convenio desde 2009 y Trade Republic declara esa retención como no deducible; aquí se sigue ese criterio.
            {y.forExcess >= 0.5 && ` Los ${eur(y.forExcess)} que se retuvieron de más no se deducen en España; en los países con convenio se pueden reclamar a su hacienda.`}
            {' '}La deducción final ({eur(y.dii)}) no puede superar tu tipo medio del ahorro aplicado a esos dividendos. Si un país
            retiene y el CSV ya trae el dividendo neto, el bruto se reconstruye con la retención habitual de ese país
            {y.grossedN > 0 ? ` (${y.grossedN} ${y.grossedN === 1 ? 'cobro' : 'cobros'} este año, ${eur(y.grossedUp)} retenidos fuera que el CSV no trae)` : ''}:
            compruébalo con el informe fiscal del bróker.
          </p>
        </div>
      )}
      </div>
      <div className={pane('renta')}>
      <section className="card rw-index">
        <header className="rw-index-h">
          <div>
            <h2>Para trasladar a Renta Web</h2>
            <p>Ejercicio {y.year} · pulsa un importe para copiarlo. Lo de la sucursal española ya viene en tus datos fiscales;
              lo de la alemana no se lo comunica a Hacienda y lo das de alta tú.</p>
          </div>
          {manualN > 0 && <span className="rw-tag manual"><Icon name="plus" size={12} />{manualN} {manualN === 1 ? 'alta' : 'altas'} por hacer en Renta Web</span>}
        </header>
        <nav aria-label="Casillas de la declaración">
          <ul>
            {allForms.map((f) => {
              const v = headline(f);
              const manual = f.records.some((r) => r.status === 'manual');
              return (
                <li key={f.id}>
                  <button type="button" onClick={() => document.getElementById(`rw-${f.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    <span className="rw-box">{f.key ?? f.box ?? '—'}</span>
                    <span className="rw-index-t">{f.short ?? f.title}</span>
                    {v != null && <b>{eur(v)}</b>}
                    {manual && <i className="rw-dot" aria-label="Con altas por hacer en Renta Web" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </section>
      {allForms.map((f) => <RentaForm key={f.id} {...f} copy={copy} copied={copied} />)}
      <p className="note">
        Las casillas cambian de número entre campañas: si no encuentras una, búscala por su nombre en Renta Web.
      </p>
      </div>
      <details className="note legal">
        <summary><b>Orientativo, no es asesoramiento fiscal.</b> Cómo se calcula</summary>
        Hacienda exige FIFO por valor homogéneo, que es lo que se calcula
        aquí a partir de tu CSV. La regla de los dos meses y la compensación de pérdidas se aplican de forma
        aproximada (por fecha de compra, sin distinguir lotes del mismo día); el CSV trae una sola cifra de retención por
        dividendo, y el reparto entre España y el país de origen se deduce de ella. Intereses, saveback y bonus se tratan como rendimientos
        del capital mobiliario. Contrasta siempre con el informe fiscal de tu bróker.
      </details>
    </div>
  );
}
