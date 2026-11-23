// Tipos del dominio: el contrato entre el back (que calcula las posiciones a partir del CSV) y
// el front (que las agrega y las pinta). Es el primer archivo que conviene leer.
//
// Fechas: siempre texto 'AAAA-MM-DD' (IsoDate) o 'AAAA-MM' (IsoMonth). Importes: euros.

export type IsoDate = string;
export type IsoMonth = string;
export type Isin = string;

// ---------- posiciones y sus eventos (back/src/engine) ----------

/** Grupo de activos: acciones y ETF, o Private Markets. */
export type AssetGroup = 'ac' | 'pm';
/** Filtro de la vista: un grupo o todo. */
export type GroupFilter = AssetGroup | 'all';

/** Lote de compra pendiente de vender (criterio FIFO). */
export interface Lot {
  /** Acciones que quedan del lote. */
  sh: number;
  /** Coste por acción, con comisiones. */
  unit: number;
  /** Fecha de la compra. */
  d: IsoDate;
}

interface EventBase {
  /** Identificador corto (los últimos caracteres del de la transacción). */
  id: string;
  /** Identificador de la transacción en el CSV (o `manual-…`, `split-…`). */
  tid: string;
  /** Fecha. */
  d: IsoDate;
  /** Acciones de la operación. */
  sh: number;
  /** Importe bruto. */
  g: number;
  fee: number;
  tax: number;
  /** Importe neto: lo que sale (compra) o entra (venta, dividendo) de verdad. */
  net: number;
  /** Explicación para el usuario cuando el CSV no trae el dato tal cual. */
  note?: string;
}

interface TradeBase extends EventBase {
  /** Precio por acción. */
  px: number;
  /** Acciones de la posición después de la operación. */
  sa: number;
  /** Coste de la posición después de la operación. */
  ca: number;
}

export interface BuyEvent extends TradeBase {
  k: 'B';
  /** Coste medio por acción después de la compra. */
  av: number;
  /** Acciones recibidas por una escisión (spin-off): entran a coste cero. */
  spin?: boolean;
}

export interface SellEvent extends TradeBase {
  k: 'S';
  /** Coste medio por acción antes de la venta. */
  avb: number;
  /** Coste de lo vendido a coste medio, y su resultado. */
  cs: number;
  re: number;
  /** Coste de lo vendido por FIFO (criterio fiscal), y su resultado. */
  csF: number;
  reF: number;
  /** Lotes consumidos por la venta. */
  lotsUsed: Lot[];
}

export interface DividendEvent extends EventBase {
  k: 'D';
  /** Importe en la divisa original ('12.34 USD'), o '' si se cobró en euros. */
  orig: string;
}

export interface SplitEvent extends TradeBase {
  k: 'X';
  /** Acciones nuevas por cada acción antigua. */
  ratio: number;
  /** Acciones antes del split. */
  from: number;
  av: number;
}

export type PositionEvent = BuyEvent | SellEvent | DividendEvent | SplitEvent;

/** Varias ejecuciones del mismo día juntas en una sola orden (shared/calc: mergeFills). */
export type Fill<E extends PositionEvent = PositionEvent> = E & { ids?: string[]; parts?: E[] };

/** Posición tal como la calcula el motor. */
export interface EnginePosition {
  isin: Isin;
  name: string;
  /** Tipo de activo del CSV: STOCK, FUND, PRIVATE_FUND… */
  cls: string;
  grp: AssetGroup;
  /** Acciones en cartera. */
  sh: number;
  /** Coste de lo que queda en cartera (coste medio). */
  cost: number;
  evs: PositionEvent[];
  lots: Lot[];
  open: boolean;
  /** Nota sobre movimientos que no entran en el coste (ajustes de impuestos de Private Markets). */
  extra?: string;
}

/** Datos de la cotización en vivo de un valor. */
export interface PriceInfo {
  symbol?: string;
  exchange?: string;
  currency?: string;
  /** Precio en la divisa del valor. */
  raw?: number;
  /** Tipo de cambio a euros aplicado. */
  rate?: number;
  /** Hora de la cotización (ISO). */
  time?: string | null;
  /** Variación de la última sesión, en %. */
  dayPct?: number | null;
  /** Es un valor liquidativo publicado, no una cotización de mercado. */
  nav?: boolean;
  name?: string;
}

/** Posición con su precio, como la recibe el front (GET /api/portfolio más GET /api/events). */
export interface Position extends EnginePosition {
  /** Número de eventos (los eventos viajan aparte). */
  nev: number;
  /** Precio actual en euros, o null si no se conoce. */
  price: number | null;
  priceAt: string | null;
  priceSource: 'manual' | 'live' | null;
  priceInfo: PriceInfo | null;
  /** Hay una fuente de precio para este valor, aunque ahora mande uno a mano. */
  quotable: boolean;
  sector: string | null;
  industry: string | null;
  /** Nota libre del usuario. */
  note: string | null;
}

// ---------- histórico diario (back/src/history) ----------

/** Serie de un índice de referencia, alineada con los días del histórico. */
export interface BenchmarkSeries {
  key: string;
  name: string;
  /** Cierre en euros de cada día (null antes de que el índice cotice). */
  c: (number | null)[];
  /** Solo en el índice propio: su composición en texto. */
  mix?: string;
}

/** Valor de la cartera día a día. Todas las listas tienen la longitud de `d`. */
export interface History {
  d: IsoDate[];
  /** Valor de la cartera. */
  v: number[];
  /** Capital invertido (coste de lo que hay en cartera). */
  cost: number[];
  /** Índice de rentabilidad ponderada por tiempo, base 100. */
  idx: number[];
  /** Compras, ventas y dividendos del día, en euros. */
  buy: number[];
  sell: number[];
  div: number[];
  benchmarks: BenchmarkSeries[];
  splits?: number;
  /** Posiciones abiertas sin cotización histórica (valoradas en línea recta). */
  unpriced?: string[];
  /** Las mismas series por grupo de activos, si la cartera mezcla grupos. */
  groups?: Partial<Record<AssetGroup, Partial<History>>>;
}

/** Histórico con las sumas acumuladas de los flujos (shared/perf: prepare). */
export interface PreparedHistory extends History {
  cumBuy: number[];
  cumSell: number[];
  cumDiv: number[];
  /** Cada día en milisegundos (UTC). */
  t: number[];
}

// ---------- efectivo (back/src/engine: buildCash) ----------

/** Concepto de un movimiento de efectivo. */
export type CashGroup = 'deposit' | 'withdrawal' | 'card' | 'invest' | 'dividend' | 'interest' | 'reward' | 'tax' | 'other';
/** Importe con signo de cada concepto en un mes. */
export type CashMonth = Partial<Record<CashGroup, number>>;

export interface Cash {
  /** Saldo disponible. */
  balance: number;
  months: Record<IsoMonth, CashMonth>;
  /** Saldo al cierre de cada día con movimientos: [día, saldo]. */
  days: [IsoDate, number][];
}

// ---------- patrimonio y ajustes ----------

export type AccountKind = 'cash' | 'deposit' | 'property' | 'other' | 'debt';

export interface AccountBalance {
  d: IsoDate;
  /** Siempre positivo; en una deuda, lo que queda por pagar. */
  amount: number;
}

/** Cuenta, bien o deuda que el usuario anota a mano. */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  created_at?: string;
  balances: AccountBalance[];
}

/** Plan de la proyección guardado en la cuenta. */
export interface Plan {
  monthly: number | null;
  rate: number | null;
  years: number | null;
  goal: number | null;
  /** Valor de la cartera y día desde los que se mide el plan (van juntos). */
  start: number | null;
  since: IsoDate | null;
}

/** Índice de referencia propio: mezcla de índices con pesos en %. */
export interface BenchmarkBlend {
  parts: { key: string; w: number }[];
}
