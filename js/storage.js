// Capa de persistencia del journal.
//
// Hoy guarda todo en localStorage (un solo objeto JSON). app.js solo habla con
// `JournalStore`, así que para la versión SaaS alcanza con escribir otro adapter
// (por ejemplo uno que llame a una API REST) y asignarlo en `JournalStore.adapter`.

const STORAGE_KEY = 'tradingChecklistState';
const SCHEMA_VERSION = 2;

// Cada usuario tiene su propio journal bajo `tradingChecklistState:<userId>`.
// Una cuenta nueva siempre arranca vacía: no se adoptan datos de otras claves.
const LocalStorageAdapter = {
  userId: null,
  key(){
    return STORAGE_KEY + ':' + this.userId;
  },
  load(){
    if(!this.userId) return null;
    const raw = localStorage.getItem(this.key());
    if(!raw) return null;
    try{
      return JSON.parse(raw);
    }catch(e){
      // Si el journal está dañado, se guarda una copia antes de que se pise.
      try{ localStorage.setItem(this.key() + ':corrupt', raw); }catch(_){}
      throw e;
    }
  },
  save(data){
    if(!this.userId) return;
    localStorage.setItem(this.key(), JSON.stringify(data));
  },
  clear(){
    localStorage.removeItem(this.key());
  },
};

// Migraciones entre versiones del esquema. Cada función recibe los datos en la
// versión N-1 y los devuelve en la versión N.
const MIGRATIONS = {
  // Datos del artifact original (sin schemaVersion): ya tienen la forma de la v1.
  1: data => data,
  // v2: varias cuentas. El tipo de cuenta y las reglas de prop firm, que eran
  // únicos, pasan a una primera cuenta y todos los trades quedan en ella.
  2: data => {
    const fr = isObj(data.fundedRules) ? data.fundedRules : {};
    const prop = data.accountType === 'funded';
    const acc = newAccount({
      id: 'acc_main',
      name: prop ? 'Cuenta de fondeo' : 'Mi cuenta',
      type: prop ? (String(fr.profitTarget || '').trim() ? 'challenge' : 'funded') : 'personal',
      createdAt: Math.min(Date.now(), ...(Array.isArray(data.history) ? data.history.map(h=> h && h.ts).filter(Number.isFinite) : [])),
      rules: prop ? fr : {},
    });
    if(Array.isArray(data.history)) data.history.forEach(h=>{ if(isObj(h)) h.accountId = acc.id; });
    data.accounts = [acc];
    data.viewAccount = 'all';
    delete data.accountType;
    delete data.fundedRules;
    return data;
  },
};

// ---- Cuentas ----
const ACCOUNT_TYPES = ['personal', 'challenge', 'funded'];
const ACCOUNT_STATUS = ['active', 'passed', 'failed', 'archived'];
const ruleStr = v=> (typeof v === 'string' || typeof v === 'number') ? String(v).slice(0, 10) : '';
// Una cuenta con todos sus campos y tipos correctos. Las reglas se guardan como
// texto (lo que escribió el usuario) y se interpretan al calcular.
function newAccount(a = {}){
  const r = isObj(a.rules) ? a.rules : {};
  return {
    id: safeId(a.id) || ('acc_' + Date.now() + '_' + Math.floor(Math.random() * 1e4)),
    name: (typeof a.name === 'string' && a.name.trim()) ? a.name.trim().slice(0, 40) : 'Cuenta',
    type: ACCOUNT_TYPES.includes(a.type) ? a.type : 'personal',
    firm: typeof a.firm === 'string' ? a.firm.trim().slice(0, 40) : '',
    size: (typeof a.size === 'number' && isFinite(a.size) && a.size > 0) ? a.size : null,
    status: ACCOUNT_STATUS.includes(a.status) ? a.status : 'active',
    createdAt: (typeof a.createdAt === 'number' && isFinite(a.createdAt)) ? a.createdAt : Date.now(),
    rules: {
      dailyDrawdown: ruleStr(r.dailyDrawdown), totalDrawdown: ruleStr(r.totalDrawdown), profitTarget: ruleStr(r.profitTarget),
      ddType: r.ddType === 'trailing' ? 'trailing' : 'static', ddLock: !!r.ddLock,
      minDays: ruleStr(r.minDays), consistency: ruleStr(r.consistency),
    },
  };
}

function migrate(data){
  let version = data.schemaVersion || 0;
  while(version < SCHEMA_VERSION){
    version++;
    data = MIGRATIONS[version](data);
  }
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}

function isQuotaError(e){
  return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
}

// Fecha local AAAA-MM-DD (para nombres de archivo).
function localDateStamp(){
  const d = new Date(), z = n=> String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

const VALID_RESULTS = ['win', 'loss', 'be'];
const safeId = v=> String(v == null ? '' : v).replace(/[^\w-]/g, '').slice(0, 60);
const isObj = v=> v && typeof v === 'object' && !Array.isArray(v);
const optNum = v=> (typeof v === 'number' && isFinite(v)) ? v : null;
const optStr = (v, max = 500)=> (typeof v === 'string' && v.trim()) ? v.slice(0, max) : null;

// Normaliza un backup importado: tipos correctos y nada que pueda romper la app.
function sanitizeImport(data){
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter(it=> isObj(it) && typeof it.label === 'string' && it.label.trim())
    .map(it=> ({id: safeId(it.id) || ('item_' + Date.now() + '_' + Math.floor(Math.random() * 1e4)), label: it.label.slice(0, 200), hint: optStr(it.hint, 200) || '', ...(optNum(it.createdAt) ? {createdAt: it.createdAt} : {})}));
  let dropped = 0;
  const history = data.history.filter(h=>{
    const ok = isObj(h) && typeof h.ts === 'number' && isFinite(h.ts);
    if(!ok) dropped++;
    return ok;
  }).map((h, i)=>{
    const img = typeof h.image === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(h.image) ? h.image : null;
    return {
      id: safeId(h.id) || ('item_' + h.ts + '_' + i),
      ts: h.ts, loggedAt: optNum(h.loggedAt) || h.ts,
      followedPlan: !!h.followedPlan,
      missing: Array.isArray(h.missing) ? h.missing.filter(x=> typeof x === 'string').map(x=> x.slice(0, 200)) : [],
      ...(Array.isArray(h.missingIds) ? {missingIds: h.missingIds.map(safeId).filter(Boolean)} : {}),
      ...(optNum(h.rulesTotal) ? {rulesTotal: h.rulesTotal} : {}),
      ...(optNum(h.score) !== null && h.score >= 0 && h.score <= 100 ? {score: Math.round(h.score)} : {}),
      result: VALID_RESULTS.includes(h.result) ? h.result : (optNum(h.resultPct) > 0 ? 'win' : optNum(h.resultPct) < 0 ? 'loss' : 'be'),
      resultPct: optNum(h.resultPct), riskPct: optNum(h.riskPct), rrPlanned: optNum(h.rrPlanned), durationMin: optNum(h.durationMin),
      asset: optStr(h.asset, 40), setup: optStr(h.setup, 200),
      direction: ['long', 'short'].includes(h.direction) ? h.direction : null,
      emotion: typeof emotionById === 'function' && emotionById(h.emotion) ? h.emotion : null,
      confidence: [1, 2, 3, 4, 5].includes(h.confidence) ? h.confidence : null,
      errors: Array.isArray(h.errors) ? h.errors.filter(e=> typeof errorById !== 'function' || errorById(e)) : [],
      note: typeof h.note === 'string' ? h.note.slice(0, 5000) : '',
      image: img,
      ...(optNum(h.editedAt) ? {editedAt: h.editedAt} : {}),
      accountId: safeId(h.accountId),
    };
  });
  const reviews = {};
  if(isObj(data.reviews)) Object.entries(data.reviews).forEach(([k, r])=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(k) || !isObj(r)) return;
    reviews[k] = {good: optStr(r.good, 5000) || '', error: optStr(r.error, 5000) || '', change: optStr(r.change, 5000) || '',
      score: [1,2,3,4,5,6,7,8,9,10].includes(r.score) ? r.score : null, savedAt: optNum(r.savedAt) || Date.now()};
  });
  const ids = new Set();
  const accounts = (Array.isArray(data.accounts) ? data.accounts : []).filter(isObj).map(newAccount)
    .filter(a=> !ids.has(a.id) && ids.add(a.id)).slice(0, 50);
  if(!accounts.length) accounts.push(newAccount({id: 'acc_main', name: 'Mi cuenta'}));
  history.forEach(h=>{ if(!ids.has(h.accountId)) h.accountId = accounts[0].id; });
  return {
    schemaVersion: data.schemaVersion,
    history, items, reviews,
    checked: {},
    bestStreak: 0,
    maxDailyRisk: (typeof data.maxDailyRisk === 'string' || typeof data.maxDailyRisk === 'number') ? String(data.maxDailyRisk).slice(0, 10) : '',
    accounts,
    viewAccount: data.viewAccount === 'all' || ids.has(data.viewAccount) ? data.viewAccount : 'all',
    goals: {planPct: isObj(data.goals) && optNum(data.goals.planPct) ? data.goals.planPct : 80},
    ...(Array.isArray(data.sessions) ? {sessions: data.sessions.filter(s=> isObj(s) && typeof s.name === 'string' && s.name.trim()
      && HHMM.test(s.start) && HHMM.test(s.end) && s.start !== s.end).slice(0, 12)
      .map((s, i)=> ({id: safeId(s.id) || 'ses_' + i, name: s.name.trim().slice(0, 30), start: s.start, end: s.end}))} : {}),
    timePrefs: {display: isObj(data.timePrefs) && data.timePrefs.display === 'local' ? 'local' : 'ny',
      dayEnd: isObj(data.timePrefs) && data.timePrefs.dayEnd === 17 ? 17 : 0},
    achievements: {},
    _dropped: dropped,
  };
}

const JournalStore = {
  adapter: LocalStorageAdapter,
  onSaveError: null,
  onLoadError: null,

  setUser(userId){
    this.adapter.userId = userId;
  },

  load(){
    try{
      const data = this.adapter.load();
      return data ? migrate(data) : null;
    }catch(e){
      console.error('load error', e);
      if(this.onLoadError) this.onLoadError(e);
      return null;
    }
  },

  save(state){
    try{
      this.adapter.save({...state, schemaVersion: SCHEMA_VERSION});
      return true;
    }catch(e){
      console.error('save error', e);
      if(this.onSaveError) this.onSaveError(isQuotaError(e) ? 'quota' : 'unknown', e);
      return false;
    }
  },

  exportToFile(state){
    const data = {...state, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString()};
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'journal-trading-' + localDateStamp() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 1500);
  },

  parseImport(text){
    let data;
    try{ data = JSON.parse(text); }
    catch(e){ throw new Error('El archivo no es un backup válido (no se pudo leer).'); }
    if(!data || typeof data !== 'object' || !Array.isArray(data.history)){
      throw new Error('El archivo no parece un backup del journal.');
    }
    if((data.schemaVersion || 0) > SCHEMA_VERSION){
      throw new Error('El backup es de una versión más nueva de la app.');
    }
    delete data.exportedAt;
    return sanitizeImport(migrate(data));
  },
};
