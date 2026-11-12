import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Icon, Seg } from '../components/ui.jsx';
import { Columns } from '../charts.jsx';
import { taxYears, savingsTax } from '../lib/calc.js';
import { country } from '../lib/countries.js';
import { eur, eurS, num, qty, sign, date, pct } from '../lib/format.js';

/** Ventas y dividendos del ejercicio en un CSV listo para trasladar a la declaración. */
function exportYear(y) {
  const n = (v) => String(+v.toFixed(2)).replace('.', ',');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [
    ['tipo', 'fecha', 'valor', 'isin', 'pais', 'cantidad', 'valor_transmision', 'valor_adquisicion', 'resultado', 'fechas_adquisicion', 'dividendo_bruto', 'retencion'].join(';'),
    ...y.sales.map((x) => ['venta', x.d, q(x.p.name), x.p.isin, q(country(x.p.isin)), String(+x.sh.toFixed(6)).replace('.', ','), n(x.net), n(x.csF), n(x.reF),
      q([...new Set(x.lotsUsed.map((l) => l.d))].join(' ')), '', ''].join(';')),
    ...y.divs.map((x) => ['dividendo', x.d, q(x.p.name), x.p.isin, q(country(x.p.isin)), String(+x.sh.toFixed(6)).replace('.', ','), '', '', '', '', n(x.g), n(x.tax)].join(';')),
  ];
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  el.download = `fiscalidad-${y.year}.csv`;
  el.click();
  URL.revokeObjectURL(el.href);
}

export default function Tax({ a, income, onOpen }) {
  const years = useMemo(() => taxYears(a.sl, a.dv, income), [a.sl, a.dv, income]);
  const [sel, setSel] = useState(null);
  if (!years.length) return <div className="card"><Empty>Todavía no hay ventas, dividendos ni intereses que declarar.</Empty></div>;
  const y = years.find((r) => r.year === sel) ?? years[0];
  const diff = y.gainF - y.gainAvg;
  // Base del ahorro orientativa: ganancias netas más rendimientos, con la compensación de pérdidas ya aplicada.
  const base = y.base;
  const quota = savingsTax(base), due = quota - y.withheld;
  const lost = y.gainTax - y.usedPrev < 0; // el año cierra con pérdidas patrimoniales
  const byCountry = Object.values(y.divs.reduce((m, x) => {
    const c = country(x.p.isin);
    const r = (m[c] ??= { c, n: 0, g: 0, t: 0 });
    r.n++; r.g += x.g; r.t += x.tax;
    return m;
  }, {})).sort((p, q) => q.g - p.g);

  return (
    <div className="stack">
      <div className="toolbar">
        <Seg label="Ejercicio" options={years.map((r) => [r.year, r.year])} value={y.year} onChange={setSel} />
        <button type="button" className="btn" onClick={() => exportYear(y)}><Icon name="download" size={16} />Exportar {y.year}</button>
      </div>

      <Card title={`Estimación del ejercicio ${y.year}`} sub="Base del ahorro: ganancias patrimoniales netas más rendimientos del capital">
        <div className="perf">
          <div><span className="stat-l">Base del ahorro</span><b className="stat-v">{eur(base)}</b></div>
          <div><span className="stat-l">Cuota estimada</span><b className="stat-v">{eur(quota)}</b></div>
          <div><span className="stat-l">{due >= 0 ? 'A pagar tras retenciones' : 'A devolver'}</span><b className="stat-v">{eur(Math.abs(due))}</b></div>
        </div>
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
          <div><span>Retenciones ya practicadas (dividendos{y.intT > 0 ? ', intereses' : ''}{y.rewT > 0 ? ', premios' : ''})</span><b>{eur(y.withheld)}</b></div>
          {y.carryOut >= 0.005 && <div><span>Pérdidas pendientes para los próximos ejercicios</span><b className="loss">−{eur(y.carryOut)}</b></div>}
        </div>
        <p className="note">
          {lost && <>Las pérdidas patrimoniales no restan directamente: compensan como mucho el 25 % de los rendimientos del año y el resto
            se guarda para los cuatro ejercicios siguientes. </>}
          Tramos del ahorro: 19 % hasta 6.000 €, 21 % hasta 50.000 €, 23 % hasta 200.000 €, 27 % hasta 300.000 € y 30 % en
          adelante. Trata toda la retención como ya ingresada en España, así que si parte es retención extranjera la cifra a
          pagar real será distinta (se recupera por doble imposición con límites). No incluye rentas de fuera de esta cuenta.
        </p>
      </Card>

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

      <div className="cols">
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

        <Card title={`Dividendos ${y.year}`} sub="Rendimientos del capital mobiliario">
          <div className="calc">
            <div><span>Ingresos íntegros ({y.divs.length} cobros)</span><b>{eur(y.divG)}</b></div>
            <div><span>− Retenciones ya practicadas</span><b>−{eur(y.divT)}</b></div>
            <div className="t"><span>= Neto cobrado</span><b>{eur(y.divG - y.divT)}</b></div>
            <div><span>Retención efectiva</span><b>{y.divG ? pct((y.divT / y.divG) * 100) : '—'}</b></div>
          </div>
        </Card>
      </div>

      {years.length > 1 && (
        <Card title="Resultado realizado por ejercicio" sub="Criterio FIFO">
          <Columns signed height={180} label="Resultado realizado por ejercicio"
            data={[...years].reverse().map((r) => ({ key: r.year, label: r.year, v: r.gainF, n: r.sales.length }))}
            tip={(d) => <><small>{d.label} · {d.n} ventas</small><b>{eurS(d.v)}</b></>} />
        </Card>
      )}

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

      {byCountry.length > 0 && (
        <div className="card table-card">
          <header className="card-h"><div><h2>Dividendos de {y.year} por país</h2><p>Para la deducción por doble imposición internacional</p></div></header>
          <table className="tbl">
            <thead><tr><th className="l">País</th><th className="hide-s">Cobros</th><th>Bruto</th><th>Retención</th><th>% efectivo</th></tr></thead>
            <tbody>
              {byCountry.map((r) => (
                <tr key={r.c} className="static">
                  <td className="l"><b>{r.c}</b></td><td className="hide-s">{r.n}</td><td>{eur(r.g)}</td><td>{eur(r.t)}</td><td>{r.g ? pct((r.t / r.g) * 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="l">Total</td><td className="hide-s">{y.divs.length}</td><td>{eur(y.divG)}</td><td>{eur(y.divT)}</td><td>{y.divG ? pct((y.divT / y.divG) * 100) : '—'}</td></tr></tfoot>
          </table>
        </div>
      )}

      <div className="card table-card">
        <header className="card-h"><div><h2>Resumen por ejercicio</h2></div></header>
        <table className="tbl">
          <thead><tr><th className="l">Ejercicio</th><th className="hide-s">Ventas</th><th className="hide-s">Transmisión</th>
            <th>Resultado FIFO</th><th className="hide-m">Con coste medio</th><th>Dividendos brutos</th><th className="hide-s">Retenciones</th></tr></thead>
          <tbody>
            {years.map((r) => (
              <tr key={r.year} onClick={() => setSel(r.year)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && setSel(r.year)}>
                <td className="l"><b>{r.year}</b></td><td className="hide-s">{r.sales.length}</td><td className="hide-s">{eur(r.proceeds)}</td>
                <td className={sign(r.gainF)}>{eurS(r.gainF)}</td><td className={`hide-m ${sign(r.gainAvg)}`}>{eurS(r.gainAvg)}</td>
                <td>{eur(r.divG)}</td><td className="hide-s">{eur(r.divT)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note">
        <b>Orientativo, no es asesoramiento fiscal.</b> Hacienda exige FIFO por valor homogéneo, que es lo que se calcula
        aquí a partir de tu CSV. La regla de los dos meses y la compensación de pérdidas se aplican de forma
        aproximada (por fecha de compra, sin distinguir lotes del mismo día); el CSV no distingue la retención española
        de la extranjera (la tabla por país ayuda a repartirla). Intereses, saveback y bonus se tratan como rendimientos
        del capital mobiliario. Contrasta siempre con el informe fiscal de tu bróker.
      </p>
    </div>
  );
}
