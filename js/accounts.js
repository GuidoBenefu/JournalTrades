// Cuentas: personal, challenge de prop firm y fondeada, cada una con sus reglas.
// Selector de cuenta en la barra superior, cuenta del trade en el formulario,
// progreso de las reglas en Inicio y editor en Ajustes.
// El modelo (newAccount, accountById, viewTrades...) vive en storage.js y app.js.

const ACCOUNT_TYPE_LABELS = {personal: 'Personal', challenge: 'Challenge', funded: 'Fondeada'};
const ACCOUNT_STATUS_LABELS = {active: 'Activa', passed: 'Aprobada', failed: 'Quemada', archived: 'Archivada'};
const ACCOUNT_STATUS_TONE = {active: '', passed: 'good', failed: 'bad', archived: ''};

const ruleNum = v=>{
  const n = parseFloat(String(v || '').replace(',', '.'));
  return isNaN(n) || n <= 0 ? null : n;
};
const r6 = v=> Math.round(v * 1e6) / 1e6;
const USD_FMT = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
// "≈ $3,200" cuando la cuenta tiene tamaño cargado.
function accMoney(acc, pct){
  return acc.size ? ' (≈ ' + USD_FMT.format(acc.size * pct / 100) + ')' : '';
}
function accountLabel(acc){
  return acc.name + (acc.firm && acc.firm !== acc.name ? ' · ' + acc.firm : '');
}

// Estado de las reglas de una cuenta según sus trades, en orden cronológico.
// Los resultados son % de la cuenta y se suman (igual que en el resto del journal).
function evalAccount(acc){
  const r = acc.rules;
  const daily = ruleNum(r.dailyDrawdown), total = ruleNum(r.totalDrawdown), target = ruleNum(r.profitTarget);
  const minDays = ruleNum(r.minDays), consistency = ruleNum(r.consistency);
  const all = state.history.filter(h=> h.accountId === acc.id).sort((a, b)=> a.ts - b.ts);
  const today = dayKeyFromTs(Date.now());
  const dayPnl = {};
  let cum = 0, peak = 0, floor = total ? -total : null, breach = null;
  all.forEach(h=>{
    const k = dayKeyFromTs(h.ts);
    if(!(k in dayPnl)) dayPnl[k] = 0;
    if(h.resultPct === null || h.resultPct === undefined) return;
    cum += h.resultPct;
    dayPnl[k] += h.resultPct;
    if(cum > peak) peak = cum;
    if(total){
      floor = r.ddType !== 'trailing' ? -total : r.ddLock ? Math.min(peak - total, 0) : peak - total;
      if(!breach && r6(cum) <= r6(floor)) breach = {rule: 'drawdown máximo', ts: h.ts};
    }
    if(daily && !breach && r6(dayPnl[k]) <= -daily) breach = {rule: 'drawdown diario', ts: h.ts};
  });
  const todayPnl = dayPnl[today] || 0;
  const days = Object.keys(dayPnl).length;
  const bestDay = Math.max(0, ...Object.values(dayPnl));
  const consRatio = cum > 0 ? bestDay / cum * 100 : null;
  const dailyLeft = daily ? Math.max(0, daily + Math.min(0, todayPnl)) : null;
  const totalLeft = total ? Math.max(0, cum - floor) : null;
  const targetMet = target ? r6(cum) >= target : false;
  const daysMet = minDays ? days >= minDays : true;
  const consMet = consistency ? consRatio !== null && r6(consRatio) <= consistency : true;
  const lefts = [dailyLeft, totalLeft].filter(v=> v !== null);
  return {daily, total, target, minDays, consistency, cum, peak, floor, todayPnl, days, bestDay, consRatio,
    dailyLeft, totalLeft, margin: lefts.length ? Math.min(...lefts) : null,
    breach, targetMet, daysMet, consMet, passed: !!target && targetMet && daysMet && consMet,
    hasRules: !!(daily || total || target || minDays || consistency), n: all.length};
}

// ---------- Selector de cuenta (barra superior) ----------

function renderAccountSwitch(){
  const sel = document.getElementById('accountSwitch');
  const visible = state.accounts.filter(a=> a.status !== 'archived' || a.id === state.viewAccount);
  sel.style.display = state.accounts.length > 1 ? '' : 'none';
  sel.innerHTML = `<option value="all">Todas las cuentas</option>` + visible.map(a=>
    `<option value="${a.id}">${escapeHtml(a.name)}${a.status !== 'active' ? ' (' + ACCOUNT_STATUS_LABELS[a.status].toLowerCase() + ')' : ''}</option>`).join('');
  sel.value = state.viewAccount;
}
document.getElementById('accountSwitch').addEventListener('change', e=>{
  state.viewAccount = e.target.value;
  saveState();
  renderFormAccount();
  renderAll();
});

// ---------- Cuenta del trade (formulario) ----------

// Para un trade nuevo: la cuenta que se está mirando o la primera activa.
function defaultFormAccount(){
  const open = openAccounts();
  if(open.some(a=> a.id === state.viewAccount)) return state.viewAccount;
  return (open[0] || state.accounts[0]).id;
}
function formAccountId(){
  const v = document.getElementById('tradeAccountInput').value;
  return accountById(v) ? v : defaultFormAccount();
}
function renderFormAccount(selected){
  const sel = document.getElementById('tradeAccountInput');
  const cur = selected || (editingTradeId ? sel.value : defaultFormAccount());
  // Al editar, el trade puede estar en una cuenta que ya no está activa.
  const list = state.accounts.filter(a=> a.status === 'active' || a.id === cur);
  sel.innerHTML = list.map(a=> `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  sel.value = list.some(a=> a.id === cur) ? cur : (list[0] || {}).id;
  document.getElementById('tradeAccountField').style.display = list.length > 1 ? '' : 'none';
  renderAccountHint();
}
// Margen que le queda hoy a la cuenta elegida y aviso si el riesgo del trade lo supera.
function renderAccountHint(){
  const box = document.getElementById('accountHint');
  const acc = accountById(formAccountId());
  const e = acc && isPropAccount(acc) && !editingTradeId ? evalAccount(acc) : null;
  if(!e || e.margin === null){ box.textContent = ''; box.className = 'field-hint'; return; }
  const which = e.dailyLeft !== null && e.dailyLeft === e.margin ? 'el drawdown diario' : 'el drawdown máximo';
  const risk = parseNum(document.getElementById('riskInput').value);
  const over = typeof risk === 'number' && !isNaN(risk) && risk > e.margin;
  box.className = 'field-hint' + (over || e.margin <= 0 ? ' hint-bad' : '');
  box.textContent = e.margin <= 0
    ? `${acc.name}: ya no te queda margen hasta ${which}. Hoy no operes esta cuenta.`
    : over
      ? `Cuidado: arriesgás ${fix1(risk)}% y en ${acc.name} te quedan ${fix1(e.margin)}% hasta ${which}.`
      : `${acc.name}: te quedan ${fix1(e.margin)}%${accMoney(acc, e.margin)} hasta ${which}.`;
}
document.getElementById('tradeAccountInput').addEventListener('change', renderAccountHint);
document.getElementById('riskInput').addEventListener('input', renderAccountHint);

// ---------- Inicio: progreso de las cuentas de prop firm ----------

function ruleBar(title, used, limit, sub){
  used = Math.max(0, used);
  const ratio = Math.min(used / limit, 1);
  const col = ratio >= 0.8 ? 'var(--danger)' : ratio >= 0.5 ? 'var(--amber)' : 'var(--brand)';
  return `<div class="fp-row">
    <div class="top"><span>${title}</span><span>${fix1(used)}% / ${limit}%</span></div>
    <div class="bar"><div class="fill" style="width:${Math.round(ratio * 100)}%; background:${col};"></div></div>
    <div class="sub">${sub}</div>
  </div>`;
}
function goalBar(title, value, goal, unit, sub){
  const ratio = Math.min(Math.max(0, value) / goal, 1);
  return `<div class="fp-row">
    <div class="top"><span>${title}</span><span>${unit === '%' ? fix1(Math.max(0, value)) : value}${unit} / ${goal}${unit}</span></div>
    <div class="bar"><div class="fill" style="width:${Math.round(ratio * 100)}%; background:var(--brand);"></div></div>
    <div class="sub">${sub}</div>
  </div>`;
}

// Estado que se muestra arriba de cada cuenta.
function accountVerdict(acc, e){
  if(acc.status !== 'active') return {tone: ACCOUNT_STATUS_TONE[acc.status], text: ACCOUNT_STATUS_LABELS[acc.status]};
  if(e.breach) return {tone: 'bad', text: 'Regla rota', action: 'failed',
    msg: `Rompiste el ${e.breach.rule} el ${fmtDate(e.breach.ts)}. Si tu prop firm la dio por perdida, marcala como quemada.`};
  if(e.passed) return {tone: 'good', text: 'Objetivo cumplido', action: 'passed',
    msg: 'Cumpliste todas las reglas del challenge. Cuando tu firma lo confirme, marcala como aprobada.'};
  if(e.targetMet) return {tone: 'warn', text: 'Falta una regla', msg: !e.daysMet ? 'Llegaste al objetivo pero te faltan días operados.' : 'Llegaste al objetivo pero tu mejor día pesa demasiado (regla de consistencia).'};
  return {tone: '', text: 'En curso'};
}

function propAccountHtml(acc){
  const e = evalAccount(acc);
  const fmt = fmtSignedPct;
  const v = accountVerdict(acc, e);
  let rows = '';
  if(e.daily) rows += ruleBar('Drawdown diario', -e.todayPnl, e.daily,
    `Hoy: ${fmt(e.todayPnl)} · ${e.dailyLeft > 0 ? 'te quedan ' + fix1(e.dailyLeft) + '%' + accMoney(acc, e.dailyLeft) : 'límite alcanzado'}`);
  if(e.total){
    const trailing = acc.rules.ddType === 'trailing';
    rows += ruleBar('Drawdown máximo' + (trailing ? ' (trailing' + (acc.rules.ddLock ? ', se congela en el inicial)' : ')') : ' (estático)'),
      e.total - e.totalLeft, e.total,
      (trailing ? `Pico: ${fmt(e.peak)} · Piso: ${fmt(e.floor)} · ` : '') + `Acumulado: ${fmt(e.cum)} · ${e.totalLeft > 0 ? 'te quedan ' + fix1(e.totalLeft) + '%' + accMoney(acc, e.totalLeft) : 'límite alcanzado'}`);
  }
  if(e.target) rows += goalBar('Profit target', e.cum, e.target, '%',
    e.targetMet ? 'Objetivo alcanzado' : `Te falta ${fix1(e.target - Math.max(0, e.cum))}%${accMoney(acc, e.target - Math.max(0, e.cum))}`);
  if(e.minDays) rows += goalBar('Días operados', e.days, e.minDays, '',
    e.daysMet ? 'Mínimo cumplido' : `Te ${e.minDays - e.days === 1 ? 'falta 1 día' : 'faltan ' + (e.minDays - e.days) + ' días'} con trades`);
  if(e.consistency) rows += `<div class="fp-row">
    <div class="top"><span>Consistencia</span><span>${e.consRatio === null ? '—' : Math.round(e.consRatio) + '%'} / máx. ${e.consistency}%</span></div>
    <div class="sub">${e.consRatio === null ? 'Se mide cuando tengas ganancia acumulada.' : `Tu mejor día (${fmt(e.bestDay)}) es el ${Math.round(e.consRatio)}% de la ganancia total. ${e.consMet ? 'Dentro de la regla.' : 'Supera el máximo: necesitás más días en verde.'}`}</div>
  </div>`;
  return `<div class="acct-prog">
    <div class="acct-prog-head">
      <div><b>${escapeHtml(acc.name)}</b><span>${ACCOUNT_TYPE_LABELS[acc.type]}${acc.firm ? ' · ' + escapeHtml(acc.firm) : ''}${acc.size ? ' · ' + USD_FMT.format(acc.size) : ''}</span></div>
      <span class="tag ${v.tone}">${v.text}</span>
    </div>
    ${v.msg ? `<div class="acct-msg ${v.tone}"><span>${v.msg}</span>${v.action ? `<button type="button" class="small" data-acc-status="${v.action}" data-acc="${acc.id}">Marcar como ${ACCOUNT_STATUS_LABELS[v.action].toLowerCase()}</button>` : ''}</div>` : ''}
    ${rows || '<p class="empty">Cargá las reglas de esta cuenta en Ajustes → Cuentas.</p>'}
  </div>`;
}

function renderPropAccounts(){
  const card = document.getElementById('fundedProgressCard');
  const list = state.accounts.filter(a=> isPropAccount(a) && a.status === 'active'
    && (state.viewAccount === 'all' || a.id === state.viewAccount));
  card.style.display = list.length ? '' : 'none';
  if(!list.length) return;
  document.getElementById('fundedProgressTitle').textContent = list.length === 1 ? 'Cuenta de fondeo' : 'Cuentas de fondeo';
  const box = document.getElementById('fundedProgress');
  box.innerHTML = list.map(propAccountHtml).join('');
  box.querySelectorAll('[data-acc-status]').forEach(b=> b.addEventListener('click', ()=> setAccountStatus(b.dataset.acc, b.dataset.accStatus)));
}

function setAccountStatus(id, status){
  const acc = accountById(id);
  if(!acc) return;
  acc.status = status;
  saveState();
  afterAccountsChange();
}

// ---------- Ajustes: lista y editor de cuentas ----------

let editingAccountId = null; // id, 'new' o null

function accountRowHtml(acc){
  const e = isPropAccount(acc) ? evalAccount(acc) : null;
  const n = state.history.filter(h=> h.accountId === acc.id).length;
  const v = e ? accountVerdict(acc, e) : {tone: ACCOUNT_STATUS_TONE[acc.status], text: ACCOUNT_STATUS_LABELS[acc.status]};
  const canFund = acc.type === 'challenge' && acc.status === 'passed';
  return `<div class="acct-row ${acc.status === 'archived' ? 'archived' : ''}">
    <div class="acct-main">
      <b>${escapeHtml(acc.name)}</b>
      <span>${ACCOUNT_TYPE_LABELS[acc.type]}${acc.firm ? ' · ' + escapeHtml(acc.firm) : ''}${acc.size ? ' · ' + USD_FMT.format(acc.size) : ''} · ${n} ${n === 1 ? 'trade' : 'trades'}</span>
    </div>
    <span class="tag ${v.tone}">${v.text}</span>
    <div class="acct-actions">
      ${canFund ? `<button type="button" class="small" data-acc-fund="${acc.id}">Crear fondeada</button>` : ''}
      <button type="button" class="small ghost" data-acc-edit="${acc.id}">Editar</button>
    </div>
  </div>`;
}

function renderAccounts(){
  const sorted = state.accounts.slice().sort((a, b)=> (a.status === 'archived') - (b.status === 'archived'));
  document.getElementById('accountCount').textContent = state.accounts.length === 1 ? '1 cuenta' : state.accounts.length + ' cuentas';
  const list = document.getElementById('accountList');
  list.innerHTML = sorted.map(a=> editingAccountId === a.id ? accountEditorHtml(a) : accountRowHtml(a)).join('')
    + (editingAccountId === 'new' ? accountEditorHtml(null) : '');
  document.getElementById('addAccountBtn').style.display = editingAccountId ? 'none' : '';
  list.querySelectorAll('[data-acc-edit]').forEach(b=> b.addEventListener('click', ()=>{ editingAccountId = b.dataset.accEdit; renderAccounts(); }));
  list.querySelectorAll('[data-acc-fund]').forEach(b=> b.addEventListener('click', ()=> createFundedFrom(b.dataset.accFund)));
  if(editingAccountId) bindAccountEditor();
}

// Borrador del editor: se arma al abrirlo y se guarda solo con "Guardar".
let accDraft = null;

function accountEditorHtml(acc){
  if(!accDraft || accDraft._for !== (acc ? acc.id : 'new')){
    accDraft = acc ? JSON.parse(JSON.stringify(acc)) : {...newAccount({type: state.accounts.some(isPropAccount) ? 'challenge' : 'personal'}), name: ''};
    accDraft._for = acc ? acc.id : 'new';
  }
  const d = accDraft, r = d.rules, prop = isPropAccount(d);
  const pct = (id, label, val, ph)=> `<div class="field"><label for="${id}">${label}</label>
    <div class="input-suffix"><input type="text" inputmode="decimal" id="${id}" value="${escapeHtml(val)}" placeholder="${ph}"><span>%</span></div></div>`;
  const n = acc ? state.history.filter(h=> h.accountId === acc.id).length : 0;
  return `<div class="acct-editor">
    <div class="set-sub">${acc ? 'Editar cuenta' : 'Nueva cuenta'}</div>
    <div class="field">
      <label>Tipo</label>
      <div class="seg" id="accTypeSeg">
        ${Object.entries(ACCOUNT_TYPE_LABELS).map(([k, l])=> `<button type="button" data-v="${k}" class="${d.type === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <div class="field-hint">${d.type === 'personal' ? 'Tu propia cuenta, sin reglas de una prop firm.' : d.type === 'challenge' ? 'La evaluación de una prop firm: tenés que llegar al objetivo sin romper las reglas.' : 'Cuenta ya fondeada: se cuidan los drawdowns, sin objetivo.'}</div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="accName">Nombre</label><input type="text" id="accName" maxlength="40" value="${escapeHtml(d.name)}" placeholder="${prop ? 'Ej. Challenge 50K fase 1' : 'Ej. Mi cuenta'}"></div>
      ${prop ? `<div class="field"><label for="accFirm">Prop firm</label><input type="text" id="accFirm" maxlength="40" value="${escapeHtml(d.firm)}" placeholder="Ej. tu prop firm"></div>` : ''}
      <div class="field"><label for="accSize">Tamaño en USD (opcional)</label><input type="text" inputmode="decimal" id="accSize" value="${d.size || ''}" placeholder="Ej. 50000"></div>
    </div>
    ${prop ? `<div class="set-sub">Reglas</div>
    <div class="form-grid">
      ${pct('accDaily', 'Drawdown diario', r.dailyDrawdown, 'Ej. 5')}
      ${pct('accTotal', 'Drawdown máximo', r.totalDrawdown, 'Ej. 10')}
      <div class="field"><label>Tipo de drawdown máximo</label>
        <div class="seg" id="accDdSeg"><button type="button" data-v="static" class="${r.ddType !== 'trailing' ? 'active' : ''}">Estático</button><button type="button" data-v="trailing" class="${r.ddType === 'trailing' ? 'active' : ''}">Trailing</button></div>
      </div>
      ${d.type === 'challenge' ? pct('accTarget', 'Profit target', r.profitTarget, 'Ej. 8') : ''}
      <div class="field"><label for="accMinDays">Días mínimos (opcional)</label><input type="text" inputmode="numeric" id="accMinDays" value="${escapeHtml(r.minDays)}" placeholder="Ej. 4"></div>
      ${pct('accCons', 'Consistencia (opcional)', r.consistency, 'Ej. 30')}
    </div>
    ${r.ddType === 'trailing' ? `<div class="field"><label class="check-row"><input type="checkbox" id="accLock" ${r.ddLock ? 'checked' : ''}><span>El piso deja de subir cuando llega al balance inicial (mi firma congela el trailing)</span></label></div>` : ''}
    <div class="field-hint">La consistencia limita cuánto puede pesar tu mejor día sobre la ganancia total (ej. 30%: ningún día puede ser más del 30% del total).</div>` : ''}
    ${acc ? `<div class="field"><label>Estado</label>
      <div class="seg" id="accStatusSeg">${Object.entries(ACCOUNT_STATUS_LABELS).map(([k, l])=> `<button type="button" data-v="${k}" class="${d.status === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    </div>` : ''}
    <div class="field-error" id="accError"></div>
    <div class="acct-editor-actions">
      ${acc && state.accounts.length > 1 ? `<button type="button" class="danger-o small" id="accDelete">${n ? 'Eliminar…' : 'Eliminar'}</button>` : ''}
      <span></span>
      <button type="button" class="ghost small" id="accCancel">Cancelar</button>
      <button type="button" class="primary small" id="accSave">Guardar</button>
    </div>
  </div>`;
}

// Pasa lo escrito en los inputs al borrador (antes de redibujar o guardar).
function readAccountEditor(){
  const v = id=> { const el = document.getElementById(id); return el ? el.value.trim() : null; };
  const d = accDraft;
  if(v('accName') !== null) d.name = v('accName');
  if(v('accFirm') !== null) d.firm = v('accFirm');
  if(v('accSize') !== null) d.size = v('accSize');
  const map = {accDaily: 'dailyDrawdown', accTotal: 'totalDrawdown', accTarget: 'profitTarget', accMinDays: 'minDays', accCons: 'consistency'};
  Object.entries(map).forEach(([id, k])=>{ if(v(id) !== null) d.rules[k] = v(id); });
  const lock = document.getElementById('accLock');
  if(lock) d.rules.ddLock = lock.checked;
}

function bindAccountEditor(){
  const seg = (id, apply)=> document.querySelectorAll('#' + id + ' button').forEach(b=> b.addEventListener('click', ()=>{
    readAccountEditor(); apply(b.dataset.v); renderAccounts();
  }));
  seg('accTypeSeg', v=> accDraft.type = v);
  seg('accDdSeg', v=> accDraft.rules.ddType = v);
  seg('accStatusSeg', v=> accDraft.status = v);
  document.getElementById('accCancel').addEventListener('click', ()=>{ editingAccountId = null; accDraft = null; renderAccounts(); });
  document.getElementById('accSave').addEventListener('click', saveAccountEditor);
  const del = document.getElementById('accDelete');
  if(del) del.addEventListener('click', deleteAccount);
  const name = document.getElementById('accName');
  if(name && !name.value) name.focus();
}

function saveAccountEditor(){
  readAccountEditor();
  const d = accDraft, err = document.getElementById('accError');
  const fail = msg=>{ err.textContent = msg; };
  if(!d.name) return fail('Poné un nombre para reconocer la cuenta.');
  const size = String(d.size || '').replace(/[$\s.]/g, '').replace(',', '.');
  if(size && !(Number(size) > 0)) return fail('El tamaño tiene que ser un número (ej. 50000).');
  const prop = isPropAccount(d);
  if(prop){
    const pcts = {dailyDrawdown: 'drawdown diario', totalDrawdown: 'drawdown máximo', profitTarget: 'profit target', consistency: 'consistencia'};
    for(const [k, l] of Object.entries(pcts)){
      const raw = d.rules[k];
      if(raw && !(ruleNum(raw) && ruleNum(raw) <= 100)) return fail(`Revisá el ${l}: tiene que ser un número entre 0 y 100.`);
    }
    if(d.rules.minDays && !(Number.isInteger(Number(d.rules.minDays)) && Number(d.rules.minDays) > 0)) return fail('Los días mínimos tienen que ser un número entero (ej. 4).');
  }
  // Una personal no lleva reglas; una fondeada no tiene objetivo.
  if(!prop) d.rules = newAccount().rules;
  if(d.type === 'funded') d.rules.profitTarget = '';
  const clean = newAccount({...d, size: size ? Number(size) : null});
  const i = state.accounts.findIndex(a=> a.id === clean.id);
  if(i >= 0) state.accounts[i] = clean; else state.accounts.push(clean);
  if(!saveState()) return fail('No se pudo guardar.');
  editingAccountId = null; accDraft = null;
  afterAccountsChange();
}

function deleteAccount(){
  const acc = accountById(editingAccountId);
  if(!acc || state.accounts.length < 2) return;
  const trades = state.history.filter(h=> h.accountId === acc.id);
  const other = state.accounts.find(a=> a.id !== acc.id && a.status === 'active') || state.accounts.find(a=> a.id !== acc.id);
  if(trades.length){
    // Los trades no se borran: pasan a otra cuenta (o se puede archivar la cuenta).
    if(!confirm(`"${acc.name}" tiene ${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}. Si la eliminás, pasan a "${other.name}". Si querés conservarlos aparte, mejor archivala (Estado → Archivada). ¿Eliminar igual?`)) return;
    trades.forEach(h=> h.accountId = other.id);
  }
  state.accounts = state.accounts.filter(a=> a.id !== acc.id);
  if(state.viewAccount === acc.id) state.viewAccount = 'all';
  editingAccountId = null; accDraft = null;
  saveState();
  afterAccountsChange();
}

// Un challenge aprobado pasa a una cuenta fondeada nueva, con las mismas reglas
// de drawdown y sin objetivo.
function createFundedFrom(id){
  const src = accountById(id);
  if(!src) return;
  const acc = newAccount({...src, id: null, createdAt: Date.now(), type: 'funded', status: 'active',
    name: (src.firm || src.name).slice(0, 30) + ' fondeada', rules: {...src.rules, profitTarget: '', minDays: '', consistency: ''}});
  state.accounts.push(acc);
  saveState();
  editingAccountId = acc.id; accDraft = null;
  afterAccountsChange();
}

function afterAccountsChange(){
  renderAccounts();
  renderAccountSwitch();
  renderFormAccount();
  renderAll();
}

document.getElementById('addAccountBtn').addEventListener('click', ()=>{ editingAccountId = 'new'; accDraft = null; renderAccounts(); });

// Las reglas dependen de los trades: se redibujan con cada cambio.
function renderAccountsData(){ if(!editingAccountId) renderAccounts(); renderAccountSwitch(); renderAccountHint(); }
onDataChange.push(renderAccountsData);
renderAccounts();
renderAccountSwitch();
renderFormAccount();
renderPropAccounts();
