// Plan frente a realidad: cuánto debería valer hoy la cartera según el plan que fijaste
// (valor de partida, aportación mensual y rentabilidad esperada) y cuánto vale de verdad.
import { project } from './calc.js';

/** Meses completos entre dos días AAAA-MM-DD. */
export function monthsBetween(from, to) {
  const m = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) - (to.slice(8, 10) < from.slice(8, 10) ? 1 : 0);
  return Math.max(0, m);
}

/**
 * @param plan   el plan fijado: { start, since, monthly, rate }: valor y día en que se fijó, aportación y % anual
 * @param value  valor de la cartera hoy
 * @returns avance: { months, expected, diff, pct } (diff > 0 = vas por delante), o null si el plan no está fijado
 */
export function planProgress(plan, value, today = new Date().toISOString().slice(0, 10)) {
  if (!plan?.since || plan.start == null || plan.since > today) return null;
  const months = monthsBetween(plan.since, today);
  const expected = project({ start: plan.start, monthly: plan.monthly ?? 0, rate: plan.rate ?? 0, years: months / 12 }).at(-1).v;
  const diff = value - expected;
  return { months, expected, diff, pct: expected > 0 ? (diff / expected) * 100 : null };
}
