import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Icon, Seg } from '../components/ui.jsx';
import { Columns } from '../charts.jsx';
import { taxYears, splitWithholding, TREATY_RATE } from '../lib/calc.js';
import { country, classLabel } from '../lib/countries.js';
import { eur, eurS, num, qty, sign, date, pct, isMasked } from '../lib/format.js';

/** Ventas y dividendos del ejercicio en un CSV listo para trasladar a la declaración. */
function exportYear(y) {
  const n = (v) => String(+v.toFixed(2)).replace('.', ',');
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [
    ['tipo', 'fecha', 'valor', 'isin', 'pais', 'cantidad', 'valor_transmision', 'valor_adquisicion', 'resultado', 'fechas_adquisicion', 'dividendo_bruto', 'retencion', 'retencion_espana', 'retencion_origen'].join(';'),
    ...y.sales.map((x) => ['venta', x.d, q(x.p.name), x.p.isin, q(country(x.p.isin)), String(+x.sh.toFixed(6)).replace('.', ','), n(x.net), n(x.csF), n(x.reF),
      q([...new Set(x.lotsUsed.map((l) => l.d))].join(' ')), '', '', '', ''].join(';')),
    ...y.divs.map((x) => {
      const w = splitWithholding(x.g, x.tax, x.p.isin);
      return ['dividendo', x.d, q(x.p.name), x.p.isin, q(country(x.p.isin)), String(+(x.sh ?? 0).toFixed(6)).replace('.', ','), '', '', '', '', n(x.g), n(x.tax), n(w.es), n(w.foreign)].join(';');
    }),
  ];
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  el.download = `fiscalidad-${y.year}.csv`;
  el.click();
  URL.revokeObjectURL(el.href);
}

const LIMIT_720 = 50000;
/** Valor de la cartera al cierre del ejercicio (o el último conocido si aún no ha acabado). */
function yearEndValue(hist, year) {
  if (!hist?.d?.length) return null;
  const end = `${year}-12-31`;
  let i = hist.d.length - 1;
  while (i >= 0 && hist.d[i] > end) i--;
  return i < 0 ? null : { v: hist.v[i], d: hist.d[i], closed: hist.d.at(-1) >= end };
}

export default function Tax({ a, income, onOpen, hist, flt }) {
  const years = useMemo(() => taxYears(a.sl, a.dv, income), [a.sl, a.dv, income]);
  const [sel, setSel] = useState(null);
  if (!years.length) return <div className="card"><Empty>Todavía no hay ventas, dividendos ni intereses que declarar.</Empty></div>;
  const y = years.find((r) => r.year === sel) ?? years[0];
  const diff = y.gainF - y.gainAvg;
  // Base del ahorro orientativa: ganancias netas más rendimientos, con la compensación de pérdidas ya aplicada.
  const base = y.base;
  const quota = y.quota, due = y.due;
  const lost = y.gainTax - y.usedPrev < 0; // el año cierra con pérdidas patrimoniales
  const byCountry = Object.values(y.countries).map((r) => ({ ...r, c: country(r.isin) })).sort((p, q) => q.g - p.g);
  const end = flt === 'all' ? yearEndValue(hist, y.year) : null;
  const unlisted = y.issuers.filter((e) => e.p.grp === 'pm');
  // Lo que se traslada a Renta Web. Solo llevan número las casillas contrastadas; el resto se
  // localiza por su nombre, porque la numeración cambia de una campaña a otra.
  const boxes = [
    y.intN > 0 && ['0027', 'Intereses de cuentas y depósitos', y.intG],
    y.divs.length > 0 && ['0029', 'Dividendos y demás rendimientos por la participación en fondos propios', y.divG],
    y.rewN > 0 && [null, 'Saveback y bonus (otros rendimientos del capital mobiliario)', y.rewG],
    y.withheld >= 0.005 && [null, 'Retenciones por rendimientos del capital mobiliario', y.withheld],
    y.sales.length > 0 && ['0328', 'Acciones negociadas: valor de transmisión (suma de todas las entidades)', y.proceeds],
    y.sales.length > 0 && ['0331', 'Acciones negociadas: valor de adquisición (suma de todas las entidades)', y.costF],
    Math.abs(y.deferred) >= 0.005 && [null, 'Pérdidas no imputables por recompra de valores homogéneos', -y.deferred],
    y.usedPrev + y.offsetRcm >= 0.005 && [null, 'Pérdidas de este y otros ejercicios que se compensan', y.usedPrev + y.offsetRcm],
    y.dii >= 0.005 && ['0588', 'Deducción por doble imposición internacional', y.dii],
  ].filter(Boolean);

  return (
    <div className="stack">
      <div className="toolbar">
        <Seg label="Ejercicio" options={years.map((r) => [r.year, r.year])} value={y.year} onChange={setSel} />
        <button type="button" className="btn" onClick={() => exportYear(y)}><Icon name="download" size={16} />Exportar {y.year}</button>
        <button type="button" className="btn" onClick={() => window.print()}><Icon name="fiscalidad" size={16} />Informe en PDF</button>
      </div>
      <header className="print-h">
        <h1>Informe fiscal {y.year}</h1>
        <p>Generado el {date(new Date().toISOString())} a partir de tus operaciones. Orientativo: no es asesoramiento fiscal.</p>
      </header>

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
      </Card>

      <div className="card table-card">
        <header className="card-h"><div><h2>Para trasladar a Renta Web</h2><p>Ejercicio {y.year} · importes de esta cuenta</p></div></header>
        <table className="tbl boxes">
          <thead><tr><th className="l">Casilla</th><th className="l">Concepto</th><th>Importe</th></tr></thead>
          <tbody>
            {boxes.map(([box, label, v]) => (
              <tr key={label} className="static"><td className="l">{box ? <b className="box">{box}</b> : <span className="mu">—</span>}</td><td className="l wrap">{label}</td><td>{eur(v)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="note pad">
          Las ventas se introducen entidad por entidad (tabla «Ventas por entidad emisora»). Los conceptos sin número se
          buscan por su nombre en Renta Web: la numeración cambia entre campañas, así que comprueba también las que sí lo llevan.
          {unlisted.length > 0 && ` ${unlisted.map((e) => e.p.name).join(', ')} no cotiza: su venta va en el apartado de otros elementos patrimoniales, no con las acciones negociadas.`}
        </p>
      </div>

      {end && (
        <Card title="Modelo 720" sub="Declaración informativa de bienes en el extranjero">
          <div className="calc">
            <div><span>Valor de tus inversiones {end.closed ? `a 31/12/${y.year}` : `a ${date(end.d)} (el ejercicio no ha terminado)`}</span><b>{eur(end.v)}</b></div>
            <div><span>Umbral a partir del cual hay que informar</span><b>{eur(LIMIT_720)}</b></div>
          </div>
          <p className={`note ${end.v > LIMIT_720 && !isMasked() ? 'warn-t' : ''}`}>
            {isMasked()
              ? 'Importes ocultos: muéstralos para saber si superas el umbral. '
              : end.v > LIMIT_720
              ? <><Icon name="alert" size={15} /> Superas el umbral. Si tus valores se consideran depositados en el extranjero habría que presentar el modelo 720 (hasta el 31 de marzo del año siguiente) la primera vez y cuando el valor suba más de 20.000 €. </>
              : 'Estás por debajo del umbral. '}
            Con Trade Republic no hay un criterio claro: con IBAN español el efectivo no se declara, pero sobre los valores
            las fuentes no coinciden. Confírmalo con la Agencia Tributaria o con un asesor; cuenta también lo que tengas en otros brókeres extranjeros.
          </p>
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
            <div><span>− Retención española (a cuenta del IRPF)</span><b>−{eur(y.divEs)}</b></div>
            <div><span>− Retención en el país de origen</span><b>−{eur(y.divFor)}</b></div>
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

      {y.issuers.length > 0 && (
        <div className="card table-card">
          <header className="card-h"><div><h2>Ventas de {y.year} por entidad emisora</h2><p>Una línea por valor, como las pide Renta Web</p></div></header>
          <table className="tbl">
            <thead><tr><th className="l">Entidad</th><th className="l hide-s">ISIN</th><th className="hide-s">Ventas</th><th>Transmisión</th><th>Adquisición</th><th>Resultado</th></tr></thead>
            <tbody>
              {y.issuers.map((e) => (
                <tr key={e.p.isin} onClick={() => onOpen(e.p.isin)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(e.p.isin)}>
                  <td className="l"><b>{e.p.name}</b>{e.p.grp === 'pm' && <small className="mu"> · {classLabel(e.p.cls)}</small>}</td>
                  <td className="l hide-s mono">{e.p.isin}</td><td className="hide-s">{e.n}</td>
                  <td>{eur(e.proceeds)}</td><td>{eur(e.cost)}</td><td className={sign(e.gain)}>{eurS(e.gain)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td className="l">Total</td><td className="hide-s" /><td className="hide-s">{y.sales.length}</td><td>{eur(y.proceeds)}</td><td>{eur(y.costF)}</td><td className={sign(y.gainF)}>{eurS(y.gainF)}</td></tr></tfoot>
          </table>
        </div>
      )}

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
            Deducible = lo retenido en origen, hasta el {TREATY_RATE * 100} % del bruto (el tipo de la mayoría de convenios; algún país tiene otro).
            {y.forExcess >= 0.5 && ` Los ${eur(y.forExcess)} que se retuvieron de más no se deducen en España: se reclaman a la hacienda del país de origen.`}
            {' '}La deducción final ({eur(y.dii)}) no puede superar tu tipo medio del ahorro aplicado a esos dividendos. Si un país
            retiene y el CSV ya trae el dividendo neto de esa retención, aquí no se ve: compruébalo en el informe fiscal del bróker.
          </p>
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
        aproximada (por fecha de compra, sin distinguir lotes del mismo día); el CSV trae una sola cifra de retención por
        dividendo, y el reparto entre España y el país de origen se deduce de ella. Intereses, saveback y bonus se tratan como rendimientos
        del capital mobiliario. Contrasta siempre con el informe fiscal de tu bróker.
      </p>
    </div>
  );
}
