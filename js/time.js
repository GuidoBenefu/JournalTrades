// Horarios del journal.
//
// Todo se calcula en hora de Nueva York (America/New_York, con su horario de
// verano): el día de trading, el mes, el día de la semana, la hora del mapa de
// calor y la sesión. Así dos traders de países distintos ven lo mismo.
// Lo único que cambia según la preferencia del usuario es cómo se *muestran*
// las horas: en hora de Nueva York (por defecto) o en su hora local.
//
// Preferencias (state.timePrefs):
//   display: 'ny' | 'local'   en qué zona se muestran y se cargan las horas
//   dayEnd:  0 | 17           hora de NY en la que termina el día de trading
//                             (17:00 es el cierre de forex y futuros)

const NY_TZ = 'America/New_York';
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DEFAULT_TIME_PREFS = {display: 'ny', dayEnd: 0};

function timePrefs(){
  const p = (typeof state !== 'undefined' && state.timePrefs) || {};
  return {display: p.display === 'local' ? 'local' : 'ny', dayEnd: p.dayEnd === 17 ? 17 : 0};
}
// La zona en la que se muestran las horas.
function displayTz(){
  return timePrefs().display === 'local' ? LOCAL_TZ : NY_TZ;
}
// Si la hora local del usuario es la misma que la de Nueva York, no hace falta mostrar las dos.
function localIsNy(ts = Date.now()){
  return zoneOffset(ts, LOCAL_TZ) === zoneOffset(ts, NY_TZ);
}

const PARTS_FMT = {};
// Fecha y hora de un instante en una zona: {y, m (1-12), d, h, min}.
function zoneParts(ts, tz){
  const f = PARTS_FMT[tz] || (PARTS_FMT[tz] = new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'}));
  const p = {};
  f.formatToParts(new Date(ts)).forEach(x=>{ if(x.type !== 'literal') p[x.type] = Number(x.value); });
  return {y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute};
}
const nyParts = ts=> zoneParts(ts, NY_TZ);

// Diferencia en ms entre la hora de la zona y UTC en ese instante.
function zoneOffset(ts, tz){
  const p = zoneParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ts / 60000) * 60000;
}
// Instante que corresponde a una fecha y hora "de reloj" en una zona.
function zonedToTs(y, m, d, h, min, tz){
  const wall = Date.UTC(y, m - 1, d, h, min);
  let ts = wall - zoneOffset(wall, tz);
  // Segunda pasada por si el cambio de horario cae entre medio.
  ts = wall - zoneOffset(ts, tz);
  return ts;
}

// ---- Claves de fecha (AAAA-MM-DD), siempre del día de trading en NY ----
const pad2 = n=> String(n).padStart(2, '0');
function ymdKey(y, m, d){
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
}
function addDaysKey(key, n){
  const [y, m, d] = key.split('-').map(Number);
  return ymdKey(y, m, d + n);
}
// Día de la semana de una clave, lunes = 0.
function weekdayOfKey(key){
  const [y, m, d] = key.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

// Día de trading al que pertenece un instante. Con cierre a las 17:00 de NY,
// lo que se opera desde las 17:00 cuenta para el día siguiente.
function dayKeyFromTs(ts){
  const p = nyParts(ts);
  return ymdKey(p.y, p.m, p.d + (timePrefs().dayEnd && p.h >= timePrefs().dayEnd ? 1 : 0));
}
function monthKeyOf(ts){
  return dayKeyFromTs(ts).slice(0, 7);
}
const currentDayKey = ()=> dayKeyFromTs(Date.now());
// Inicio (instante) de un día de trading.
function dayStartTs(key){
  const [y, m, d] = key.split('-').map(Number);
  const end = timePrefs().dayEnd;
  return end ? zonedToTs(y, m, d - 1, end, 0, NY_TZ) : zonedToTs(y, m, d, 0, 0, NY_TZ);
}
// Para formatear una clave como fecha de calendario (no es un instante real).
const keyDate = key=> new Date(key + 'T12:00:00');

// Hora de NY (0-23) y día de la semana del día de trading (lunes = 0), para las estadísticas.
const nyHourOf = ts=> nyParts(ts).h;
const weekdayOf = ts=> weekdayOfKey(dayKeyFromTs(ts));

// Sesión según la hora de Nueva York del momento de entrada.
function sessionOf(ts){
  const h = nyHourOf(ts);
  if(h >= 19 || h < 3) return 'Asia';
  if(h < 8) return 'Londres';
  if(h < 17) return 'Nueva York';
  return 'Fuera de sesión';
}

// ---- Mostrar ----
const TIME_FMTS = {};
function fmtTime(ts, tz = displayTz()){
  const f = TIME_FMTS[tz] || (TIME_FMTS[tz] = new Intl.DateTimeFormat('es-AR', {timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}));
  return f.format(new Date(ts));
}
// La fecha que se muestra es la del día de trading, la misma del calendario.
const DATE_FMT = new Intl.DateTimeFormat('es-AR', {day: '2-digit', month: '2-digit', year: '2-digit'});
function fmtDate(ts){
  return DATE_FMT.format(keyDate(dayKeyFromTs(ts)));
}
// Nombre corto de la zona en que se muestran las horas ("NY" o la abreviatura local).
function displayTzLabel(){
  if(timePrefs().display === 'ny') return 'NY';
  const p = new Intl.DateTimeFormat('es-AR', {timeZone: LOCAL_TZ, timeZoneName: 'short'}).formatToParts(new Date());
  return (p.find(x=> x.type === 'timeZoneName') || {}).value || 'local';
}
// "09:42 NY · 10:42 tu hora": la otra zona, solo si es distinta.
function fmtTimeBoth(ts){
  if(localIsNy(ts)) return fmtTime(ts, NY_TZ) + ' NY';
  return fmtTime(ts, NY_TZ) + ' NY · ' + fmtTime(ts, LOCAL_TZ) + ' tu hora';
}

// ---- Campo datetime-local: se carga y se lee en la zona de visualización ----
function toLocalInputValue(ts){
  const p = zoneParts(ts, displayTz());
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d) + 'T' + pad2(p.h) + ':' + pad2(p.min);
}
function fromInputValue(v){
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if(!m) return NaN;
  return zonedToTs(+m[1], +m[2], +m[3], +m[4], +m[5], displayTz());
}
