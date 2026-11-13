// Periodo del resumen: lo elige la cabecera fija (App) y lo usa toda la página (Dashboard).
// Vive en la URL (?periodo=año) para que los dos lo compartan sin pasarse estado.
import { useParam } from '../router.js';

export const RANGES = [['mtd', 'MTD'], ['3', '3M'], ['6', '6M'], ['ytd', 'YTD'], ['12', '1A'], ['max', 'Máx']];
export const RANGE_NAME = { mtd: 'este mes', ytd: 'este año', 3: 'en 3 meses', 6: 'en 6 meses', 12: 'en un año', max: 'desde el inicio' };
const IN_URL = { mtd: 'mes', 3: '3m', 6: '6m', ytd: 'año', 12: '1a', max: 'max' };

export const useRange = () => useParam('periodo', 'ytd', IN_URL);
