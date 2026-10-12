// Sincronización del journal con Supabase (tabla `journals`).
//
// Local-first: la app sigue leyendo y escribiendo en localStorage (al instante y
// sin conexión) y este módulo sube los cambios en segundo plano. Al abrir la app
// y al volver a ella se fija si en la nube hay una versión más nueva (cargada
// desde otro dispositivo); si la hay, la trae y recarga la página.
//
// Por usuario se guarda en `tradingChecklistState:<userId>:sync`:
//   base   updated_at de la nube con el que está al día este navegador
//   dirty  hay cambios locales sin subir
//   at     cuándo fue el último cambio local
// Cada subida solo pisa la nube si sigue en `base`. Si los dos lados cambiaron
// (dos dispositivos sin conexión, por ejemplo), gana el cambio más reciente pero
// se conservan los trades, setups, cuentas y revisiones del otro.

const CloudSync = {
  status: 'idle',
  queue: Promise.resolve(),
  timer: null,
  lastPull: 0,
  reloading: false,

  uid(){ return LocalStorageAdapter.userId; },
  metaKey(){ return LocalStorageAdapter.key() + ':sync'; },
  meta(){
    try{ return JSON.parse(localStorage.getItem(this.metaKey())) || {}; }
    catch(e){ return {}; }
  },
  setMeta(changes){
    const m = {...this.meta(), ...changes};
    try{ localStorage.setItem(this.metaKey(), JSON.stringify(m)); }catch(e){}
    return m;
  },
  localData(){
    const raw = localStorage.getItem(LocalStorageAdapter.key());
    try{ return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
  },

  setStatus(status){
    this.status = status;
    renderSyncStatus();
  },
  // Sin conexión no es un error: los cambios quedan pendientes.
  fail(error){
    const offline = !navigator.onLine || /fetch|network/i.test(String(error && (error.message || error)));
    if(!offline) console.error('sync error', error);
    // 42501: RLS rechazó la escritura (la prueba terminó y no hay Pro).
    this.setStatus(offline ? 'offline' : error && error.code === '42501' ? 'locked' : 'error');
  },

  // Las operaciones van de a una, en orden.
  run(fn){
    this.queue = this.queue.then(()=> this.reloading || !this.uid() ? null : fn.call(this)).catch(e=> this.fail(e));
    return this.queue;
  },

  // Se llama en cada guardado local.
  markDirty(){
    this.setMeta({dirty: true, at: Date.now()});
    clearTimeout(this.timer);
    this.timer = setTimeout(()=> this.push(), 2000);
  },

  push(){
    clearTimeout(this.timer);
    return this.run(this._push);
  },

  pull(){
    this.lastPull = Date.now();
    return this.run(this._pull);
  },

  // fromPull: ya se trajo lo último de la nube; otro choque no se resuelve volviendo a traer.
  async _push(fromPull){
    while(this.meta().dirty && !this.reloading){
      const data = this.localData();
      if(!data){ this.setMeta({dirty: false}); break; }
      const {base, at} = this.meta();
      this.setStatus('syncing');
      const row = {data, schema_version: data.schemaVersion || 0};
      const res = base
        ? await sb().from('journals').update(row).eq('user_id', this.uid()).eq('updated_at', base).select('updated_at')
        : await sb().from('journals').insert({user_id: this.uid(), ...row}).select('updated_at');
      // Otro dispositivo subió algo después de `base` (o creó el journal antes).
      if((res.error && res.error.code === '23505') || (!res.error && !res.data.length)){
        return fromPull ? this.fail(new Error('La nube cambió durante la sincronización')) : this._pull();
      }
      if(res.error) return this.fail(res.error);
      // Si hubo cambios locales mientras subía, quedan pendientes para la próxima vuelta.
      this.setMeta({base: res.data[0].updated_at, dirty: this.meta().at !== at});
    }
    this.setStatus('synced');
  },

  async _pull(){
    const head = await sb().from('journals').select('updated_at').eq('user_id', this.uid()).maybeSingle();
    if(head.error) return this.fail(head.error);
    if(!head.data){
      // Todavía no hay nada en la nube: se sube lo de este navegador.
      if(this.localData()) this.setMeta({dirty: true, base: null});
      return this._push(true);
    }
    if(head.data.updated_at === this.meta().base) return this._push(true);

    // La nube cambió desde otro dispositivo.
    this.setStatus('syncing');
    const res = await sb().from('journals').select('data, updated_at').eq('user_id', this.uid()).single();
    if(res.error) return this.fail(res.error);
    const remote = res.data.data;
    const local = this.localData();
    const m = this.meta();
    let next, dirty = false;
    if(!local || isEmptyJournal(local) || (!m.dirty && m.base)){
      next = remote;
    } else {
      // Los dos lados tienen cambios: gana el más reciente y se suman los trades del otro.
      const localNewer = (m.at || 0) > Date.parse(res.data.updated_at);
      next = localNewer ? mergeJournals(local, remote) : mergeJournals(remote, local);
      dirty = true;
    }
    LocalStorageAdapter.save(next);
    this.setMeta({base: res.data.updated_at, dirty, at: Date.now()});
    // La app tiene en memoria la versión vieja: se recarga con la nueva (y, si hubo
    // que mezclar, al abrir se sube el resultado).
    this.reloading = true;
    location.reload();
  },
};

// Un journal recién creado en este navegador, sin nada cargado todavía.
function isEmptyJournal(d){
  const len = k=> Array.isArray(d[k]) ? d[k].length : 0;
  return !len('history') && !len('items') && !len('playbook');
}

// `winner` queda como está y se le agregan los elementos de `other` que no tiene.
// Un trade borrado en un dispositivo puede volver si el otro lo tenía: es preferible
// a perder uno.
function mergeJournals(winner, other){
  const out = {...winner};
  ['history', 'playbook', 'accounts'].forEach(k=>{
    const mine = Array.isArray(winner[k]) ? winner[k] : [];
    const ids = new Set(mine.map(x=> x && x.id));
    const extra = (Array.isArray(other[k]) ? other[k] : []).filter(x=> x && x.id && !ids.has(x.id));
    out[k] = mine.concat(extra);
  });
  out.reviews = {...(isObj(other.reviews) ? other.reviews : {}), ...(isObj(winner.reviews) ? winner.reviews : {})};
  return out;
}

// El journal se sigue guardando en localStorage y además se sube a la nube.
const CloudAdapter = {
  get userId(){ return LocalStorageAdapter.userId; },
  set userId(v){ LocalStorageAdapter.userId = v; },
  load(){ return LocalStorageAdapter.load(); },
  save(data){
    if(!this.userId) return;
    // La app guarda también al abrir y al renderizar: si no cambió nada, no hay que subir.
    const json = JSON.stringify(data);
    if(json === localStorage.getItem(LocalStorageAdapter.key())) return;
    localStorage.setItem(LocalStorageAdapter.key(), json);
    CloudSync.markDirty();
  },
  clear(){ LocalStorageAdapter.clear(); },
};
JournalStore.adapter = CloudAdapter;

// Estado de la nube en Ajustes → Datos y backup.
function renderSyncStatus(){
  const el = document.getElementById('syncStatus');
  if(!el) return;
  const text = {
    syncing: t('Guardando en la nube…'),
    synced: t('Todo guardado en la nube.'),
    offline: t('Sin conexión: los cambios se suben solos cuando vuelva.'),
    locked: t('Tu prueba terminó: los cambios nuevos se guardan solo en este navegador.'),
    error: t('No se pudo guardar en la nube. Tus datos siguen en este navegador.'),
  }[CloudSync.status];
  el.textContent = text || '';
  el.className = 'sync-status ' + CloudSync.status;
}

window.addEventListener('load', ()=> CloudSync.pull());
window.addEventListener('online', ()=> CloudSync.pull());
document.addEventListener('visibilitychange', ()=>{
  // Al salir de la app se sube lo pendiente sin esperar; al volver, se busca lo nuevo.
  if(document.hidden){ if(CloudSync.meta().dirty) CloudSync.push(); }
  else if(Date.now() - CloudSync.lastPull > 30000) CloudSync.pull();
});
