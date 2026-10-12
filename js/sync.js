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
// y en `tradingChecklistState:<userId>:base`, el journal tal como estaba en esa
// versión de la nube. Cada subida solo pisa la nube si sigue en `base`. Si los dos
// lados cambiaron (dos dispositivos sin conexión, por ejemplo), se mezclan
// comparando cada uno contra esa base: se respeta lo que se agregó, editó o borró
// de cada lado, y si los dos cambiaron lo mismo gana el cambio más reciente.

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
  baseKey(){ return LocalStorageAdapter.key() + ':base'; },
  baseData(){
    try{ return JSON.parse(localStorage.getItem(this.baseKey())); }catch(e){ return null; }
  },
  setBase(data){
    try{ localStorage.setItem(this.baseKey(), JSON.stringify(data)); }
    catch(e){ localStorage.removeItem(this.baseKey()); }
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
      this.setBase(data);
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
    const base = m.base ? this.baseData() : null;
    let next, dirty = false;
    // Sin cambios locales desde la última sincronización: se toma lo de la nube.
    if(!local || isEmptyJournal(local) || (base && (!m.dirty || canonical(local) === canonical(base)))){
      next = remote;
    } else {
      // Los dos lados cambiaron (o este navegador nunca sincronizó): se mezclan.
      next = mergeJournals(base, local, remote, (m.at || 0) > Date.parse(res.data.updated_at));
      dirty = true;
    }
    LocalStorageAdapter.save(next);
    this.setBase(remote);
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

// JSON con las claves ordenadas: el mismo contenido da el mismo texto (Postgres
// reordena las claves de un jsonb, y la app las guarda en su propio orden).
function canonical(v){
  return JSON.stringify(v, (k, x)=> isObj(x) ? Object.keys(x).sort().reduce((o, key)=>{ o[key] = x[key]; return o; }, {}) : x);
}

// Mezcla de tres vías: `base` es la versión de la nube que conocían los dos lados
// (null si este navegador nunca sincronizó: entonces se suma todo lo de ambos).
// Lo que cambió de un solo lado gana; si cambió de los dos, se mezcla adentro
// (listas por id, objetos por clave) y en lo demás gana el lado más reciente.
function mergeJournals(base, local, remote, localNewer){
  return merge3(base || {}, local, remote, localNewer);
}

function merge3(b, l, r, localNewer){
  const cl = canonical(l), cr = canonical(r);
  if(cl === cr) return l;
  const cb = canonical(b);
  if(cl === cb) return r;
  if(cr === cb) return l;
  if(isIdList(l) && isIdList(r)) return mergeById(b, l, r, localNewer);
  if(isObj(l) && isObj(r)){
    const bo = isObj(b) ? b : {}, out = {};
    new Set([...Object.keys(localNewer ? l : r), ...Object.keys(localNewer ? r : l)]).forEach(k=>{
      const v = merge3(bo[k], l[k], r[k], localNewer);
      if(v !== undefined) out[k] = v;
    });
    return out;
  }
  return localNewer ? l : r;
}

// Trades, setups, cuentas y reglas: listas de objetos con id.
function isIdList(a){
  return Array.isArray(a) && a.every(x=> isObj(x) && x.id);
}

// Lo agregado de cualquier lado se suma, lo borrado de cualquier lado se borra y
// lo editado de los dos lados se mezcla campo por campo.
function mergeById(b, l, r, localNewer){
  const byId = a=> new Map((Array.isArray(a) ? a : []).filter(x=> isObj(x) && x.id).map(x=> [x.id, x]));
  const B = byId(b), L = byId(l), R = byId(r);
  const out = [], seen = new Set();
  [...(localNewer ? L : R).keys(), ...(localNewer ? R : L).keys()].forEach(id=>{
    if(seen.has(id)) return;
    seen.add(id);
    const inL = L.has(id), inR = R.has(id);
    if(B.has(id) && !(inL && inR)) return;
    out.push(inL && inR ? merge3(B.get(id), L.get(id), R.get(id), localNewer) : (inL ? L.get(id) : R.get(id)));
  });
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
    const prev = localStorage.getItem(LocalStorageAdapter.key());
    if(json === prev) return;
    localStorage.setItem(LocalStorageAdapter.key(), json);
    // Mismo contenido con las claves en otro orden (por ejemplo, recién bajado de la nube).
    try{ if(prev && canonical(JSON.parse(prev)) === canonical(data)) return; }catch(e){}
    CloudSync.markDirty();
  },
  clear(){ LocalStorageAdapter.clear(); },
};
JournalStore.adapter = CloudAdapter;

// ---- Capturas (Supabase Storage) ----
// Cada imagen de ImageStore se sube como `<userId>/<imageId>` al bucket privado
// `journal-images` (supabase/storage.sql). Al abrir la app se compara lo local
// con la nube: se sube lo que falta y se bajan las capturas que cargó otro
// dispositivo. Nunca se borra en la nube por comparar (este navegador podría no
// tener todavía el journal más nuevo): solo cuando se borra una captura acá.
const IMAGES_BUCKET = 'journal-images';

const CloudImages = {
  reconciling: null,

  path(id){ return CloudSync.uid() + '/' + id; },
  bucket(){ return sb().storage.from(IMAGES_BUCKET); },

  async upload(id, dataUrl){
    if(!CloudSync.uid() || !id || !dataUrl) return false;
    try{
      const blob = await (await fetch(dataUrl)).blob();
      const {error} = await this.bucket().upload(this.path(id), blob, {contentType: blob.type, upsert: false});
      // Ya estaba subida (por ejemplo, desde otra pestaña).
      if(error && !(String(error.statusCode) === '409' || /exist/i.test(error.message))) throw error;
      return true;
    }catch(e){
      // Si falla (sin conexión, prueba vencida), se reintenta en la próxima comparación.
      console.warn('No se pudo subir la captura', id, e);
      return false;
    }
  },

  async remove(id){
    if(!CloudSync.uid() || !id) return;
    try{
      const {error} = await this.bucket().remove([this.path(id)]);
      if(error) throw error;
    }catch(e){
      console.warn('No se pudo borrar la captura de la nube', id, e);
    }
  },

  async download(id){
    const {data, error} = await this.bucket().download(this.path(id));
    if(error) throw error;
    return new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(r.result);
      r.onerror = ()=> reject(r.error);
      r.readAsDataURL(data);
    });
  },

  // Nombres de los archivos del usuario en la nube.
  async list(){
    const names = new Set();
    for(let offset = 0; ; offset += 1000){
      const {data, error} = await this.bucket().list(CloudSync.uid(), {limit: 1000, offset});
      if(error) throw error;
      data.forEach(f=> names.add(f.name));
      if(data.length < 1000) return names;
    }
  },

  // ids(): las capturas que usa el journal. Devuelve cuántas bajó.
  reconcile(ids){
    if(this.reconciling || !CloudSync.uid()) return this.reconciling || Promise.resolve(0);
    this.reconciling = (async ()=>{
      // Primero el journal: si otro dispositivo lo cambió, la página se recarga con
      // la versión nueva y no tiene sentido subir capturas de trades ya borrados.
      await CloudSync.firstPull;
      if(CloudSync.reloading) return 0;
      const used = [...new Set(ids().filter(Boolean))];
      let remote;
      try{ remote = await this.list(); }
      catch(e){ console.warn('No se pudieron listar las capturas', e); return 0; }
      const toUpload = used.filter(id=> ImageStore.get(id) && !remote.has(id));
      const toDownload = used.filter(id=> !ImageStore.get(id) && remote.has(id));
      let downloaded = 0;
      await runLimited(toUpload, 3, id=> this.upload(id, ImageStore.get(id)));
      await runLimited(toDownload, 4, async id=>{
        try{
          await ImageStore.put(id, await this.download(id), {fromCloud: true});
          downloaded++;
        }catch(e){ console.warn('No se pudo bajar la captura', id, e); }
      });
      return downloaded;
    })().finally(()=>{ this.reconciling = null; });
    return this.reconciling;
  },
};

// Corre fn sobre cada elemento, con a lo sumo `limit` a la vez.
async function runLimited(items, limit, fn){
  const queue = items.slice();
  await Promise.all(Array.from({length: Math.min(limit, queue.length)}, async ()=>{
    while(queue.length) await fn(queue.shift());
  }));
}

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

CloudSync.firstPull = new Promise(resolve=> window.addEventListener('load', ()=> resolve(CloudSync.pull())));
window.addEventListener('online', ()=> CloudSync.pull());
document.addEventListener('visibilitychange', ()=>{
  // Al salir de la app se sube lo pendiente sin esperar; al volver, se busca lo nuevo.
  if(document.hidden){ if(CloudSync.meta().dirty) CloudSync.push(); }
  else if(Date.now() - CloudSync.lastPull > 30000) CloudSync.pull();
});
