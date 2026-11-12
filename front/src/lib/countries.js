// País según el prefijo del ISIN. Para ETF y fondos (IE, LU) es el domicilio
// del vehículo, no el de sus inversiones.
const NAMES = {
  US: 'Estados Unidos', CA: 'Canadá', DE: 'Alemania', FR: 'Francia', ES: 'España', NL: 'Países Bajos',
  IE: 'Irlanda', LU: 'Luxemburgo', GB: 'Reino Unido', DK: 'Dinamarca', SE: 'Suecia', AT: 'Austria',
  CH: 'Suiza', IT: 'Italia', PT: 'Portugal', BE: 'Bélgica', FI: 'Finlandia', NO: 'Noruega',
  JP: 'Japón', HK: 'Hong Kong', CN: 'China', KY: 'Islas Caimán', IL: 'Israel', AU: 'Australia',
  KR: 'Corea del Sur', TW: 'Taiwán', IN: 'India', BR: 'Brasil', MX: 'México', SG: 'Singapur',
};
export const country = (isin) => {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return 'Otros';
  const code = isin.slice(0, 2);
  if (code === 'US' && isin[2] === 'N') return 'Países Bajos'; // USN… = CUSIP internacional de emisor neerlandés
  return NAMES[code] ?? code;
};

export const CLASS_LABEL = {
  STOCK: 'Acciones', FUND: 'ETF y fondos', PRIVATE_FUND: 'Private Markets',
  CRYPTO: 'Cripto', DERIVATIVE: 'Derivados', BOND: 'Renta fija',
};
export const classLabel = (c) => CLASS_LABEL[c] ?? c ?? 'Otros';

const REGION = {
  'Estados Unidos': 'Norteamérica', 'Canadá': 'Norteamérica', 'México': 'Latinoamérica', 'Brasil': 'Latinoamérica',
  'Japón': 'Asia-Pacífico', 'Hong Kong': 'Asia-Pacífico', 'China': 'Asia-Pacífico', 'Corea del Sur': 'Asia-Pacífico',
  'Taiwán': 'Asia-Pacífico', 'India': 'Asia-Pacífico', 'Singapur': 'Asia-Pacífico', 'Australia': 'Asia-Pacífico',
  'Israel': 'Oriente Medio', 'Islas Caimán': 'Otros', 'Otros': 'Otros',
};
/** Región a partir del país del ISIN; lo que no está en la tabla es Europa. */
export const region = (isin) => {
  const c = country(isin);
  return REGION[c] ?? (c.length === 2 ? 'Otros' : 'Europa');
};

// Sectores tal como los nombra la fuente de cotizaciones, en español.
const SECTOR = {
  Technology: 'Tecnología', Healthcare: 'Salud', 'Financial Services': 'Finanzas', 'Consumer Cyclical': 'Consumo cíclico',
  'Consumer Defensive': 'Consumo defensivo', 'Communication Services': 'Comunicación', Industrials: 'Industria',
  Energy: 'Energía', Utilities: 'Servicios públicos', 'Real Estate': 'Inmobiliario', 'Basic Materials': 'Materiales',
};
const noSector = (p) => (p.cls === 'STOCK' ? 'Sin clasificar' : classLabel(p.cls));
export const sector = (p) => (p.sector ? SECTOR[p.sector] ?? p.sector : noSector(p));
export const industry = (p) => p.industry || noSector(p);
export const currency = (p) => p.priceInfo?.currency ?? (p.grp === 'pm' || p.priceSource === 'manual' ? 'EUR' : 'Sin dato');
export const exchange = (p) => p.priceInfo?.exchange || (p.grp === 'pm' ? 'No cotiza' : 'Sin dato');
