// Ajustes que el usuario guarda en su cuenta (tabla user_settings): cada clave tiene su forma,
// y nada entra en la base de datos sin pasar por aquí (peticiones y copias restauradas).
import { isDate } from './validate.js';

const num = (v, min, max) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined; // undefined = no válido
};

const SHAPES = {
  // Plan de la proyección: aportación mensual, rentabilidad esperada, plazo y meta; `since` y
  // `start` fijan el día y el valor de la cartera desde los que se mide si vas por delante o por detrás.
  plan(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {
      monthly: num(v.monthly, 0, 1e6), rate: num(v.rate, -20, 30), years: num(v.years, 1, 50), goal: num(v.goal, 0, 1e10),
      start: num(v.start, 0, 1e12), since: v.since == null || v.since === '' ? null : v.since,
    };
    if (Object.values(out).includes(undefined)) return undefined;
    if (out.since != null && !(isDate(out.since) && out.since <= new Date().toISOString().slice(0, 10))) return undefined;
    if ((out.since == null) !== (out.start == null)) return undefined; // van juntos
    return out;
  },
};

export const SETTING_KEYS = Object.keys(SHAPES);
/** Valor limpio de un ajuste, o undefined si la clave no existe o el valor no encaja. */
export const cleanSetting = (key, value) => (Object.hasOwn(SHAPES, key) ? SHAPES[key](value) : undefined);
