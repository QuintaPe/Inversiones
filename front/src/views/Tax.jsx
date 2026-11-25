import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Icon, Seg, Sticky, Tabs } from '../components/ui.jsx';
import { Columns } from '../charts.jsx';
import SaleSim from './SaleSim.jsx';
import { useParam } from '../router.js';
import { taxYears, yearEnd, divFiscal, TREATY_RATE, savingsBrackets } from '../../../shared/calc.js';
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

/** Un registro por fila; cada importe se copia al pulsarlo, como se teclea en Renta Web. */
function RentaForm({ id, box, title, intro, fields, records, help, copy, copied }) {
  const total = fields.map((_, i) => records.reduce((t, r) => t + r.values[i], 0));
  const Value = ({ k, v }) => (
    <button type="button" className="box-v" disabled={isMasked()} onClick={() => copy(k, v)} aria-label={`Copiar ${eur(v)}`} title="Copiar el importe">
      {eur(v)}<Icon name={copied === k ? 'check' : 'copy'} size={15} />
    </button>
  );
  return (
    <section className="card rw" aria-labelledby={`rw-${id}`}>
      <header className="rw-h">
        <h3 id={`rw-${id}`}>{title}</h3>
        {box && <span className="box-n">Casilla {box}</span>}
      </header>
      {intro && <p className="note">{intro}</p>}
      {records.map((r, ri) => (
        <div key={ri} className="rw-rec">
          <p className="rw-rec-h">
            {records.length > 1 && <b>Registro {ri + 1} · </b>}{r.label}
            {r.hint && <small>{r.hint}</small>}
          </p>
          <div className="rw-fields" style={{ '--rw-n': fields.length }}>
            {fields.map((f, fi) => (
              <div key={f} className="rw-f"><span>{f}</span><Value k={`${id}-${ri}-${fi}`} v={r.values[fi]} /></div>
            ))}
          </div>
        </div>
      ))}
      {records.length > 1 && (
        <p className="rw-total">Resumen en Renta Web: {fields.map((f, i) => <span key={f}>{f.split(' (')[0].toLowerCase()} <b>{eur(total[i])}</b></span>)}</p>
      )}
      <dl className="rw-help">
        {help.map(([dt, dd]) => <div key={dt}><dt>{dt}</dt><dd>{dd}</dd></div>)}
      </dl>
    </section>
  );
}

const GROUP_LABEL = { iic: 'Fondo o ETF', other: 'Otros elementos', crypto: 'Moneda virtual', pm: 'Private Markets' };

export default function Tax({ a, income, onOpen }) {
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
    navigator.clipboard?.writeText(v.toFixed(2).replace('.', ',')).then(() => {
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
  // Lo que se traslada a Renta Web, agrupado como el informe fiscal de Trade Republic. Solo llevan
  // número las casillas contrastadas; el resto se localiza por su nombre, porque la numeración
  // cambia de una campaña a otra.
  const g = y.groups ?? {};
  // Dónde va cada apartado en Renta Web (todos en «Ganancias y pérdidas patrimoniales», apartado F2).
  const WHERE = {
    stock: 'Transmisión de acciones negociadas: una alta por entidad emisora, con la suma de sus ventas.',
    iic: 'Transmisión de acciones o participaciones de instituciones de inversión colectiva: una alta por fondo o ETF.',
    other: 'Transmisión de otros elementos patrimoniales, en «resto de elementos» (no inmuebles): una alta por cada valor, con su fecha de compra y de venta.',
    crypto: 'Transmisión de monedas virtuales: una alta por moneda, con su nombre.',
    pm: 'No cotiza: no va con las acciones negociadas. Contrasta el apartado con el informe de Trade Republic.',
  };
  const names = (k) => y.issuers.filter((e) => e.grp === k).map((e) => `${e.p.name} (${eurS(e.gain)})`).join(', ');
  const saleBoxes = (k, box, name) => g[k] ? [
    [box?.[0] ?? null, `${name}: valor de transmisión`, g[k].proceeds, <>{WHERE[k]} Aquí van: {names(k)}.</>],
    [box?.[1] ?? null, `${name}: valor de adquisición`, g[k].cost],
  ] : [];
  // Dos registros cuando parte del año lo pagó la sucursal alemana: lo de la española ya viene en
  // los datos fiscales; lo otro hay que darlo de alta a mano.
  const split = (g0, t0, pre, since, what) => {
    const all = { label: 'Trade Republic', values: [g0, t0, 0] };
    if (!(pre.g >= 0.005) || !since) return [all];
    return [
      { label: `Trade Republic España, desde el ${date(since)}`, hint: 'Viene en tus datos fiscales: comprueba que coincide.', values: [g0 - pre.g, t0 - pre.t, 0] },
      { label: `Antes del ${date(since)} (sucursal alemana)`, hint: `${pre.n} ${what} que no están en tus datos fiscales: pulsa «Alta Capital mobiliario» y añádelos tú.`, values: [pre.g, pre.t, 0] },
    ];
  };
  const fields = ['Ingresos íntegros', 'Retenciones', 'Gastos (administración y depósito)'];
  const gastos = ['Gastos', 'Siempre 0. Aquí solo van comisiones de custodia o administración de valores, y Trade Republic no cobra ninguna.'];
  const forms = [
    y.intN + y.rewN > 0 && {
      id: 'int', box: '0027', title: 'Intereses de cuentas, depósitos y activos financieros', fields,
      intro: 'Intereses de la cuenta, Saveback y bonus van juntos aquí: tributan el año en que los cobras, no cuando vendes lo que compraste con ellos.',
      records: split(y.intG + y.rewG, y.intT + y.rewT, y.incPre, y.incSince, 'abonos'),
      help: [
        ['Ingresos íntegros', <>Lo cobrado antes de retenciones: {eur(y.intG)} de intereses y {eur(y.rewG)} de Saveback y bonus. Lo que compras
          con el Saveback entra a ese mismo valor, así que al venderlo solo tributa lo que haya subido.</>],
        ['Retenciones', 'El 19 % que Trade Republic ya ingresó en Hacienda por ti. Se descuenta de lo que tienes que pagar.'],
        gastos,
      ],
    },
    y.divs.length > 0 && {
      id: 'div', box: '0029', title: 'Dividendos y similares', fields,
      intro: 'Los dividendos de todas tus acciones, españolas y extranjeras.',
      records: split(y.divG, y.divEs, y.divPre, y.divSince, 'cobros'),
      help: [
        ['Ingresos íntegros', <>El dividendo bruto, antes de cualquier retención, también la del país de origen.
          {y.grossedN > 0 && <> {y.grossedN} de tus cobros llegan en el CSV ya sin la retención extranjera: aquí se suma, como hace el informe de Trade Republic.</>}</>],
        ['Retenciones', <>Solo lo retenido en España ({eur(y.divEs)}). Lo que retuvo el país de origen ({eur(y.divFor)}) no va aquí: se recupera con la
          deducción por doble imposición, más abajo.</>],
        gastos,
      ],
    },
    y.forRcm + y.forGains >= 0.005 && {
      id: 'ddi', box: '0588', title: 'Deducción por doble imposición internacional',
      fields: ['Rendimientos del extranjero', 'Ganancias del extranjero', 'Impuesto satisfecho en el extranjero'],
      intro: <>Renta Web calcula la deducción con estos tres datos. Con tus cifras sale {eur(y.dii)}.</>,
      records: [{ label: 'Rentas de valores extranjeros en la base del ahorro', values: [y.forRcm, y.forGains, y.forDed] }],
      help: [
        ['Rendimientos netos reducidos del capital mobiliario obtenidos en el extranjero', 'Los dividendos brutos de empresas no españolas, con retención en origen o sin ella.'],
        ['Ganancias patrimoniales obtenidas en el extranjero', 'El resultado neto de vender valores no españoles en el año (0 si es negativo).'],
        ['Impuesto satisfecho en el extranjero', <>La retención en origen que se puede deducir: hasta el {TREATY_RATE * 100} % del bruto en los países con
          convenio, y nada en Dinamarca, que no tiene convenio con España.
          {y.forExcess >= 0.5 && <> Los {eur(y.forExcess)} retenidos por encima de ese límite no se deducen; en los países con convenio se pueden reclamar a su hacienda.</>}</>],
      ],
    },
  ].filter(Boolean);
  const boxes = [
    ...saleBoxes('stock', ['0328', '0331'], 'Acciones negociadas'),
    ...saleBoxes('iic', null, 'Fondos y ETF (IIC)'),
    ...saleBoxes('other', null, 'Otros elementos patrimoniales (warrants, ETC…)'),
    ...saleBoxes('crypto', null, 'Monedas virtuales'),
    ...saleBoxes('pm', null, 'Private Markets (no cotiza)'),
    Math.abs(y.deferred) >= 0.005 && [null, 'Pérdidas no imputables por recompra de valores homogéneos', -y.deferred],
    y.usedPrev + y.offsetRcm >= 0.005 && [null, 'Pérdidas de este y otros ejercicios que se compensan', y.usedPrev + y.offsetRcm],
  ].filter(Boolean);

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
            <thead><tr><th className="l">Entidad</th><th className="l hide-s">ISIN</th><th className="hide-s">Ventas</th><th>Transmisión</th><th>Adquisición</th><th>Resultado</th></tr></thead>
            <tbody>
              {y.issuers.map((e) => (
                <tr key={e.p.isin} onClick={() => onOpen(e.p.isin)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e.p.isin)}>
                  <td className="l"><b>{e.p.name}</b>{e.grp !== 'stock' && <small className="mu"> · {GROUP_LABEL[e.grp]}</small>}</td>
                  <td className="l hide-s mono">{e.p.isin}</td><td className="hide-s">{e.n}</td>
                  <td>{eur(e.proceeds)}</td><td>{eur(e.cost)}</td><td className={sign(e.gain)}>{eurS(e.gain)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="l">Total</td><td className="hide-s" /><td className="hide-s">{y.sales.length}</td><td>{eur(y.proceeds)}</td><td>{eur(y.costF)}</td><td className={sign(y.gainF)}>{eurS(y.gainF)}</td></tr></tfoot>
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
            <thead><tr><th className="l">País</th><th className="hide-s">Cobros</th><th>Bruto</th><th className="hide-s">Ret. española</th><th>Ret. en origen</th><th className="hide-s">% origen</th><th>Deducible</th></tr></thead>
            <tbody>
              {byCountry.map((r) => (
                <tr key={r.code} className="static">
                  <td className="l"><b>{r.c}</b></td><td className="hide-s">{r.n}</td><td>{eur(r.g)}</td><td className="hide-s">{eur(r.es)}</td>
                  <td>{eur(r.foreign)}</td><td className="hide-s">{r.g ? pct((r.foreign / r.g) * 100) : '—'}</td><td>{eur(r.ded)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="l">Total</td><td className="hide-s">{y.divs.length}</td><td>{eur(y.divG)}</td><td className="hide-s">{eur(y.divEs)}</td>
              <td>{eur(y.divFor)}</td><td className="hide-s">{y.divG ? pct((y.divFor / y.divG) * 100) : '—'}</td><td>{eur(y.forDed)}</td></tr></tfoot>
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
      <p className="note">
        Ejercicio {y.year}. Cada bloque es una ventana de Renta Web, con sus mismos campos: pulsa un importe para copiarlo.
        Las casillas cambian de número entre campañas; si no la encuentras, búscala por su nombre.
      </p>
      {forms.map((f) => <RentaForm key={f.id} {...f} copy={copy} copied={copied} />)}
      {boxes.length > 0 && (
        <section className="card">
          <header className="card-h"><div><h2>Ganancias y pérdidas patrimoniales</h2><p>Ventas del ejercicio, por apartado de la declaración</p></div></header>
          <ul className="boxes-l">
            {boxes.map(([box, label, v, where]) => (
              <li key={label}>
                <span className="box-n">{box ?? '—'}</span>
                <span className="box-t">{label}{where && <small className="box-w">{where}</small>}</span>
                <button type="button" className="box-v" disabled={isMasked()} onClick={() => copy(label, v)}
                  aria-label={`Copiar ${label}`} title="Copiar el importe">
                  {eur(v)}<Icon name={copied === label ? 'check' : 'copy'} size={15} />
                </button>
              </li>
            ))}
          </ul>
          <p className="note">
            Las cifras de cada venta están en «Ventas», tabla por entidad emisora. Un ETC (como el oro físico) no es un fondo
            aunque cotice como un ETF: es un título de deuda, por eso va con los otros elementos.
            {' '}El informe de Trade Republic da el valor de transmisión sin descontar la comisión de venta, que pone aparte; aquí
            ya va descontada, como la pide Renta Web. Por eso cada venta sale 1 € por debajo, con la misma ganancia.
          </p>
        </section>
      )}
      </div>
      <p className="note">
        <b>Orientativo, no es asesoramiento fiscal.</b> Hacienda exige FIFO por valor homogéneo, que es lo que se calcula
        aquí a partir de tu CSV. La regla de los dos meses y la compensación de pérdidas se aplican de forma
        aproximada (por fecha de compra, sin distinguir lotes del mismo día); el CSV trae una sola cifra de retención por
        dividendo, y el reparto entre España y el país de origen se deduce de ella. Intereses, saveback y bonus se tratan como rendimientos
        del capital mobiliario. Contrasta siempre con el informe fiscal de tu bróker.
      </p>
    </div>
  );
}
