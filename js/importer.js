// Importador manual de trades desde un CSV de cualquier broker o plataforma.
// El usuario elige qué columna es cada dato; todo se procesa en el navegador.
// Los trades importados quedan "por completar" (pending) hasta que se editan:
// el archivo no trae plan, emoción ni errores.

const IMP_FIELDS = [
  {k: 'date', label: t('Fecha y hora de entrada'), req: true, guess: /(open|entry|entrada|apertura).*(time|date|fecha|hora)|^(fecha|date|time|datetime|open|opened)$/i},
  {k: 'time', label: t('Hora de entrada (si viene en otra columna)'), guess: /^(hora|time)$/i},
  {k: 'exit', label: t('Fecha y hora de salida (para la duración)'), guess: /(close|exit|salida|cierre).*(time|date|fecha|hora)|^(closed?|exit)$/i},
  {k: 'asset', label: t('Activo'), guess: /^(symbol|instrument|asset|activo|s[íi]mbolo|ticker|contract|market|product)/i},
  {k: 'dir', label: t('Dirección (compra / venta)'), guess: /^(side|direction|direcci[oó]n|type|tipo|action|b\/s|buy\/sell)/i},
  {k: 'result', label: t('Resultado'), req: true, guess: /(p&l|p\/l|pnl|profit|result|resultado|ganancia|beneficio|net|realized)/i},
  {k: 'fees', label: t('Comisiones (se restan del resultado)'), guess: /(commission|comisi|fees?$|swap)/i},
  {k: 'risk', label: t('Riesgo (%)'), guess: /(risk|riesgo)/i},
  {k: 'setup', label: t('Setup'), guess: /(setup|strategy|estrategia)/i},
  {k: 'note', label: t('Nota'), guess: /(note|nota|comment|comentario)/i},
];
const IMP_MAX_BYTES = 5 * 1024 * 1024;
const IMP_MAP_KEY = 'jt_import_map';

const imp = {step: 1, file: '', rows: [], header: true, map: {}, unit: 'money', dateFmt: 'auto', tz: 'ny', accountId: null, size: '', plan: null};

// ---------- Lectura del CSV ----------

// Separador más probable mirando la primera línea (fuera de comillas).
function detectDelimiter(text){
  const line = text.split(/\r?\n/).find(l=> l.trim()) || '';
  let best = ',', bestN = 0;
  for(const d of [',', ';', '\t', '|']){
    let n = 0, q = false;
    for(const c of line){ if(c === '"') q = !q; else if(c === d && !q) n++; }
    if(n > bestN){ best = d; bestN = n; }
  }
  return best;
}
function parseCsv(text){
  text = text.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const rows = [];
  let row = [], cell = '', q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){
      if(c === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if(c === '"') q = true;
    else if(c === d){ row.push(cell); cell = ''; }
    else if(c === '\n' || c === '\r'){
      if(c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if(cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows.map(r=> r.map(c=> c.trim())).filter(r=> r.some(c=> c !== ''));
}

// Número escrito de cualquier forma: "$1,234.50", "-1.234,50", "(12.5)", "3%".
function parseLooseNum(raw){
  let s = String(raw || '').trim();
  if(!s) return null;
  let neg = false;
  if(/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^\d.,\-+]/g, '');
  if(s.startsWith('-')){ neg = !neg; s = s.slice(1); }
  s = s.replace(/^\+/, '');
  if(!/\d/.test(s)) return NaN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if(lastComma >= 0 && lastDot >= 0){
    // El separador que aparece último es el decimal.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if(lastComma >= 0){
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if((s.match(/\./g) || []).length > 1){
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return isNaN(n) ? NaN : (neg ? -n : n);
}

function parseDirection(raw){
  const s = String(raw || '').trim().toLowerCase();
  if(/^(buy|long|compra|b$|bot|bought|largo)/.test(s)) return 'long';
  if(/^(sell|short|venta|s$|sld|sold|corto)/.test(s)) return 'short';
  return null;
}

// Fecha como partes. fmt: 'ymd' | 'dmy' | 'mdy' (el ISO con zona se resuelve aparte).
const DATE_RE = /^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap])?\.?\s*m?\.?)?/i;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap])?\.?\s*m?\.?$/i;
function to24(h, ap){
  if(!ap) return h;
  ap = ap.toLowerCase();
  return ap === 'p' ? (h % 12) + 12 : h % 12;
}
function dateParts(raw, fmt){
  const m = DATE_RE.exec(String(raw || '').trim());
  if(!m) return null;
  let [a, b, c] = [+m[1], +m[2], +m[3]];
  let y, mo, d;
  if(m[1].length === 4){ y = a; mo = b; d = c; }
  else if(fmt === 'mdy'){ mo = a; d = b; y = c; }
  else { d = a; mo = b; y = c; }
  if(y < 100) y += 2000;
  const h = m[4] !== undefined ? to24(+m[4], m[7]) : null;
  return {y, mo, d, h, min: m[5] !== undefined ? +m[5] : null, hasTime: m[4] !== undefined};
}
// Formato de fecha más probable para toda la columna.
function guessDateFormat(values){
  let dmy = false, mdy = false, ymd = false, any = false;
  values.forEach(v=>{
    const m = DATE_RE.exec(String(v || '').trim());
    if(!m) return;
    any = true;
    if(m[1].length === 4){ ymd = true; return; }
    if(+m[1] > 12) dmy = true;
    if(+m[2] > 12) mdy = true;
  });
  if(ymd) return {fmt: 'ymd', sure: true};
  if(dmy && !mdy) return {fmt: 'dmy', sure: true};
  if(mdy && !dmy) return {fmt: 'mdy', sure: true};
  return {fmt: 'dmy', sure: !any};
}
const IMP_TZ = {ny: ()=> NY_TZ, local: ()=> LOCAL_TZ, utc: ()=> 'UTC'};
// Instante de una celda de fecha (y opcionalmente una de hora).
function cellToTs(dateRaw, timeRaw, fmt, tz){
  const s = String(dateRaw || '').trim();
  // ISO con zona (Z o +hh:mm): el archivo ya dice la zona.
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)){
    const iso = Date.parse(s);
    return isNaN(iso) ? NaN : iso;
  }
  const p = dateParts(s, fmt);
  if(!p || p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31) return NaN;
  let h = p.h, min = p.min;
  if(!p.hasTime && timeRaw){
    const tm = TIME_RE.exec(String(timeRaw).trim());
    if(!tm) return NaN;
    h = to24(+tm[1], tm[4]); min = +tm[2];
  }
  if(h === null){ h = 0; min = 0; }
  if(h > 23 || min > 59) return NaN;
  const zone = IMP_TZ[tz]();
  return zone === 'UTC' ? Date.UTC(p.y, p.mo - 1, p.d, h, min) : zonedToTs(p.y, p.mo, p.d, h, min, zone);
}

// ---------- Mapeo de columnas ----------

function headers(){
  const n = Math.max(...imp.rows.slice(0, 20).map(r=> r.length));
  return Array.from({length: n}, (_, i)=> imp.header && imp.rows[0][i] ? imp.rows[0][i] : t('Columna {n}', {n: i + 1}));
}
const dataRows = ()=> imp.header ? imp.rows.slice(1) : imp.rows;
const colValues = i=> dataRows().map(r=> r[i]);

// La primera fila es encabezado si casi no tiene números ni fechas.
function looksLikeHeader(row){
  const numeric = row.filter(c=> c && (!isNaN(parseLooseNum(c)) && parseLooseNum(c) !== null || DATE_RE.test(c))).length;
  return numeric <= row.length / 3;
}
function headerSignature(){ return headers().join('|').toLowerCase(); }

function guessMapping(){
  // Si ya se importó un archivo con las mismas columnas, se repite ese mapeo.
  try{
    const saved = JSON.parse(localStorage.getItem(IMP_MAP_KEY) || '{}')[headerSignature()];
    if(saved){ Object.assign(imp, saved); return; }
  }catch(e){}
  const hs = headers(), used = new Set(), map = {};
  if(imp.header) IMP_FIELDS.forEach(f=>{
    const i = hs.findIndex((h, j)=> !used.has(j) && f.guess.test(h));
    if(i >= 0){ map[f.k] = i; used.add(i); }
  });
  imp.map = map;
  const resH = map.result !== undefined ? hs[map.result] : '';
  imp.unit = /%|pct|porcent/i.test(resH) ? 'pct' : 'money';
  imp.dateFmt = 'auto';
}
function rememberMapping(){
  try{
    const all = JSON.parse(localStorage.getItem(IMP_MAP_KEY) || '{}');
    all[headerSignature()] = {map: imp.map, unit: imp.unit, dateFmt: imp.dateFmt, tz: imp.tz};
    localStorage.setItem(IMP_MAP_KEY, JSON.stringify(all));
  }catch(e){}
}

// ---------- Armado de trades ----------

function buildTrades(){
  const acc = accountById(imp.accountId);
  const size = acc && acc.size ? acc.size : parseLooseNum(imp.size);
  const fmt = imp.dateFmt === 'auto' ? guessDateFormat(colValues(imp.map.date)).fmt : imp.dateFmt;
  const get = (r, k)=> imp.map[k] === undefined ? '' : (r[imp.map[k]] || '');
  const ok = [], errors = [], dups = [];
  const existing = state.history.filter(h=> h.accountId === imp.accountId);
  const offset = imp.header ? 2 : 1;
  const now = Date.now();
  dataRows().forEach((r, i)=>{
    const line = i + offset;
    const fail = msg=> errors.push({line, msg});
    const ts = cellToTs(get(r, 'date'), get(r, 'time'), fmt, imp.tz);
    if(isNaN(ts)) return fail(t('no se entiende la fecha "{v}"', {v: get(r, 'date')}));
    if(ts > now + 5 * 60000) return fail(t('la fecha es futura'));
    const val = parseLooseNum(get(r, 'result'));
    if(val === null || isNaN(val)) return fail(t('el resultado "{v}" no es un número', {v: get(r, 'result')}));
    const fees = imp.map.fees !== undefined ? Math.abs(parseLooseNum(get(r, 'fees')) || 0) : 0;
    let pct;
    if(imp.unit === 'pct') pct = val - fees;
    else {
      if(!(size > 0)) return fail(t('falta el tamaño de la cuenta'));
      pct = (val - fees) / size * 100;
    }
    pct = Math.round(pct * 1e4) / 1e4;
    // Cerrado en 0 antes de comisiones es break even, aunque las comisiones lo dejen apenas negativo.
    const result = val === 0 ? 'be' : pct > 0 ? 'win' : pct < 0 ? 'loss' : 'be';
    if(Math.abs(pct) > 100) return fail(t('el resultado da {n}%: revisá el tamaño de la cuenta o la columna', {n: fix1(pct)}));
    const asset = get(r, 'asset').toUpperCase().slice(0, 40) || null;
    let durationMin = null;
    if(imp.map.exit !== undefined){
      const out = cellToTs(get(r, 'exit'), '', fmt, imp.tz);
      if(!isNaN(out) && out >= ts) durationMin = Math.round((out - ts) / 60000);
    }
    const risk = parseLooseNum(get(r, 'risk'));
    const trade = {
      ts, resultPct: pct, result,
      riskPct: risk !== null && !isNaN(risk) && risk > 0 && risk <= 100 ? risk : null,
      asset, direction: parseDirection(get(r, 'dir')), durationMin,
      setup: get(r, 'setup').slice(0, 200) || null, note: get(r, 'note').slice(0, 5000), line,
    };
    // Ya cargado: misma cuenta, mismo activo, mismo resultado y menos de un minuto de diferencia.
    const same = h=> Math.abs(h.ts - trade.ts) < 60000 && (h.asset || null) === trade.asset && Math.abs((h.resultPct ?? NaN) - trade.resultPct) < 0.001;
    if(existing.some(same) || ok.some(same)) dups.push(trade); else ok.push(trade);
  });
  return {ok, errors, dups, fmt};
}

function commitImport(trades){
  const followed = imp.plan === 'yes';
  const now = Date.now();
  const added = trades.map((t, i)=> ({
    id: 'item_' + now + '_imp' + i, loggedAt: now,
    ts: t.ts, followedPlan: followed,
    missing: followed ? [] : state.items.map(it=> it.label),
    missingIds: followed ? [] : state.items.map(it=> it.id),
    rulesTotal: state.items.length,
    result: t.result, resultPct: t.resultPct, riskPct: t.riskPct, rrPlanned: null, durationMin: t.durationMin,
    asset: t.asset, setup: t.setup, direction: t.direction, emotion: null, confidence: null, errors: [], note: t.note,
    accountId: imp.accountId, imported: true, pending: true,
  }));
  state.history.push(...added);
  sortHistory();
  if(!saveState()){
    const ids = new Set(added.map(h=> h.id));
    state.history = state.history.filter(h=> !ids.has(h.id));
    return false;
  }
  return added.length;
}

// ---------- Modal ----------

const $i = id=> document.getElementById(id);

function openImporter(){
  Object.assign(imp, {step: 1, file: '', rows: [], map: {}, plan: null, size: '', accountId: defaultFormAccount()});
  $i('impFile').value = '';
  $i('importer').style.display = 'flex';
  renderImporter();
}
function closeImporter(){ $i('importer').style.display = 'none'; }

function renderImporter(){
  document.querySelectorAll('#importer .ob-steps span').forEach((s, i)=> s.classList.toggle('done', i < imp.step));
  document.querySelectorAll('#importer .imp-step').forEach(s=> s.style.display = Number(s.dataset.step) === imp.step ? '' : 'none');
  $i('impBack').style.visibility = imp.step === 1 ? 'hidden' : 'visible';
  $i('impError').textContent = '';
  if(imp.step === 1) renderImpFile();
  if(imp.step === 2) renderImpMap();
  if(imp.step === 3) renderImpPreview();
}

function renderImpFile(){
  $i('impFileInfo').innerHTML = imp.rows.length
    ? `<b>${escapeHtml(imp.file)}</b> · ${tp(dataRows().length, '1 fila', '{n} filas')}` : '';
  $i('impHeader').checked = imp.header;
  $i('impHeaderRow').style.display = imp.rows.length ? '' : 'none';
  $i('impNext').textContent = t('Siguiente');
  $i('impNext').disabled = !imp.rows.length;
  const hs = imp.rows.length ? headers() : [];
  $i('impSample').innerHTML = imp.rows.length ? `<div class="imp-table-wrap"><table class="imp-table">
    <thead><tr>${hs.map(h=> `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${dataRows().slice(0, 4).map(r=> `<tr>${hs.map((_, i)=> `<td>${escapeHtml(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>` : '';
}

function renderImpMap(){
  const hs = headers();
  const sample = i=> { const v = colValues(i).find(x=> x); return v ? ' · ej. ' + v.slice(0, 24) : ''; };
  const opts = sel=> `<option value="">—</option>` + hs.map((h, i)=> `<option value="${i}" ${sel === i ? 'selected' : ''}>${escapeHtml(h + sample(i))}</option>`).join('');
  $i('impMapFields').innerHTML = IMP_FIELDS.map(f=> `<div class="field">
      <label for="impMap_${f.k}">${f.label}${f.req ? ' <span class="imp-req">*</span>' : ''}</label>
      <select id="impMap_${f.k}" data-k="${f.k}">${opts(imp.map[f.k])}</select>
    </div>`).join('');
  $i('impMapFields').querySelectorAll('select').forEach(s=> s.addEventListener('change', ()=>{
    if(s.value === '') delete imp.map[s.dataset.k]; else imp.map[s.dataset.k] = Number(s.value);
    renderImpOptions();
  }));
  renderImpOptions();
  $i('impNext').textContent = t('Revisar');
  $i('impNext').disabled = false;
}

function seg(id, value, onPick){
  document.querySelectorAll('#' + id + ' button').forEach(b=>{
    b.classList.toggle('active', b.dataset.v === value);
    b.onclick = ()=>{ onPick(b.dataset.v); renderImpOptions(); };
  });
}
function renderImpOptions(){
  seg('impUnit', imp.unit, v=> imp.unit = v);
  seg('impTz', imp.tz, v=> imp.tz = v);
  const g = imp.map.date !== undefined ? guessDateFormat(colValues(imp.map.date)) : {fmt: 'dmy', sure: true};
  $i('impDateFmt').value = imp.dateFmt;
  $i('impDateHint').textContent = imp.dateFmt !== 'auto' ? '' : g.sure
    ? t('Detectado: {fmt}.', {fmt: {ymd: t('año-mes-día'), dmy: t('día/mes/año'), mdy: t('mes/día/año')}[g.fmt]})
    : t('No se puede saber si es día/mes o mes/día (ningún día pasa de 12). Se usa día/mes/año: elegilo a mano si tu archivo es mes/día.');
  $i('impDateHint').className = 'field-hint' + (imp.dateFmt === 'auto' && !g.sure ? ' hint-bad' : '');
  const accSel = $i('impAccount');
  const list = openAccounts().length ? openAccounts() : state.accounts;
  accSel.innerHTML = list.map(a=> `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  if(!list.some(a=> a.id === imp.accountId)) imp.accountId = list[0].id;
  accSel.value = imp.accountId;
  const acc = accountById(imp.accountId);
  const needSize = imp.unit === 'money' && !(acc && acc.size);
  $i('impSizeField').style.display = needSize ? '' : 'none';
  $i('impSize').value = imp.size;
  $i('impUnitHint').textContent = imp.unit === 'pct' ? t('El resultado ya está en % de la cuenta.')
    : acc && acc.size ? t('Se pasa a % con el tamaño de "{acc}": {size}.', {acc: acc.name, size: USD_FMT.format(acc.size)}) : t('Para pasarlo a % hace falta el tamaño de la cuenta.');
}

function renderImpPreview(){
  const {ok, errors, dups} = buildTrades();
  imp._ok = ok;
  const acc = accountById(imp.accountId);
  const fmtDir = d=> d === 'long' ? t('Long') : d === 'short' ? t('Short') : '—';
  $i('impSummary').innerHTML = `
    <div class="imp-counts">
      <div><b class="pos">${ok.length}</b><span>${ok.length === 1 ? t('trade nuevo') : t('trades nuevos')}</span></div>
      <div><b>${dups.length}</b><span>${dups.length === 1 ? 'ya cargado' : 'ya cargados'} (se saltean)</span></div>
      <div><b class="${errors.length ? 'neg' : ''}">${errors.length}</b><span>${errors.length === 1 ? t('fila con error') : t('filas con error')}</span></div>
    </div>
    <p class="imp-note">Van a la cuenta <b>${escapeHtml(acc.name)}</b>. Resultado total: <b class="${signClass(ok.reduce((a, t)=> a + t.resultPct, 0))}">${fmtSignedPct(ok.reduce((a, t)=> a + t.resultPct, 0))}</b>.</p>
    ${errors.length ? `<div class="imp-errors">${errors.slice(0, 6).map(e=> `<div>${t('Fila {n}: {msg}', {n: e.line, msg: escapeHtml(e.msg)})}</div>`).join('')}${errors.length > 6 ? `<div>${t('…y {n} más.', {n: errors.length - 6})}</div>` : ''}</div>` : ''}
    ${ok.length ? `<div class="imp-table-wrap"><table class="imp-table">
      <thead><tr><th>${t('Fecha')}</th><th>${t('Hora')}</th><th>${t('Activo')}</th><th>${t('Dirección')}</th><th>${t('Resultado')}</th></tr></thead>
      <tbody>${ok.slice(0, 8).map(t=> `<tr><td>${fmtDate(t.ts)}</td><td>${fmtTime(t.ts)}</td><td>${escapeHtml(t.asset || '—')}</td><td>${fmtDir(t.direction)}</td><td class="${signClass(t.resultPct)}">${fmtSignedPct(t.resultPct)}</td></tr>`).join('')}</tbody>
    </table></div>${ok.length > 8 ? `<div class="imp-more">${t('y {n} más', {n: ok.length - 8})}</div>` : ''}` : ''}`;
  document.querySelectorAll('#impPlan .type-card').forEach(b=> b.classList.toggle('active', b.dataset.v === imp.plan));
  $i('impPlanBox').style.display = ok.length ? '' : 'none';
  $i('impNext').textContent = ok.length ? tp(ok.length, 'Importar 1 trade', 'Importar {n} trades') : t('Importar');
  $i('impNext').disabled = !ok.length;
}

$i('impFile').addEventListener('change', async e=>{
  const f = e.target.files[0];
  if(!f) return;
  $i('impError').textContent = '';
  if(f.size > IMP_MAX_BYTES){ $i('impError').textContent = t('El archivo es muy grande (máximo 5 MB).'); return; }
  const rows = parseCsv(await f.text());
  if(rows.length < 1 || Math.max(...rows.map(r=> r.length)) < 2){
    imp.rows = [];
    $i('impError').textContent = t('No se encontraron columnas. Exportá el historial como CSV (separado por comas o punto y coma).');
    renderImpFile();
    return;
  }
  Object.assign(imp, {file: f.name, rows, header: looksLikeHeader(rows[0])});
  renderImpFile();
});
$i('impHeader').addEventListener('change', e=>{ imp.header = e.target.checked; renderImpFile(); });
$i('impDateFmt').addEventListener('change', e=>{ imp.dateFmt = e.target.value; renderImpOptions(); });
$i('impAccount').addEventListener('change', e=>{ imp.accountId = e.target.value; renderImpOptions(); });
$i('impSize').addEventListener('input', e=>{ imp.size = e.target.value; $i('impError').textContent = ''; });
document.querySelectorAll('#impPlan .type-card').forEach(b=> b.addEventListener('click', ()=>{
  imp.plan = b.dataset.v;
  document.querySelectorAll('#impPlan .type-card').forEach(x=> x.classList.toggle('active', x === b));
  $i('impError').textContent = '';
}));

$i('impBack').addEventListener('click', ()=>{ if(imp.step > 1){ imp.step--; renderImporter(); } });
$i('impCancel').addEventListener('click', closeImporter);
$i('impNext').addEventListener('click', ()=>{
  const err = $i('impError');
  if(imp.step === 1){
    if(!imp.rows.length) return;
    guessMapping();
    imp.step = 2;
  } else if(imp.step === 2){
    if(imp.map.date === undefined) return err.textContent = t('Elegí la columna de la fecha de entrada.');
    if(imp.map.result === undefined) return err.textContent = t('Elegí la columna del resultado.');
    const acc = accountById(imp.accountId);
    if(imp.unit === 'money' && !(acc && acc.size)){
      const size = parseLooseNum(imp.size);
      if(!(size > 0)) return err.textContent = t('Ingresá el tamaño de la cuenta en USD (ej. 50000) para pasar el resultado a %.');
      // El tamaño queda guardado en la cuenta para la próxima.
      acc.size = size;
      saveState();
    }
    rememberMapping();
    imp.step = 3;
  } else {
    if(!imp.plan) return err.textContent = t('Elegí si estos trades respetaron tu Trading Plan.');
    const n = commitImport(imp._ok);
    if(!n) return err.textContent = t('No se pudo guardar: el almacenamiento del navegador está lleno.');
    closeImporter();
    renderAll();
    showToast(`<span class="toast-ic">${Icons.svg('file-up', 22)}</span><div><b>${tp(n, '1 trade importado', '{n} trades importados')}</b><br>${t('Quedan "por completar": sumales emoción, errores y notas.')}</div>`);
    showPendingTrades();
    return;
  }
  renderImporter();
});

// Los botones de abrir pueden dibujarse después (resumen del Historial).
document.addEventListener('click', e=>{ if(e.target.closest('[data-open-importer]')) openImporter(); });
