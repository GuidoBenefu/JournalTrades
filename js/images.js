// Capturas de los trades. Se guardan aparte, en IndexedDB, para no llenar el
// localStorage (que tiene ~5 MB y además guarda todo el journal). Los trades
// solo guardan `imageId`. Las imágenes se cargan a memoria al abrir la app, así
// el resto del código las puede leer de forma sincrónica con tradeImage(h).
//
// Si IndexedDB no está disponible (algunos modos privados), las imágenes se
// siguen guardando dentro del trade como antes (`h.image`).

const ImageStore = {
  DB: 'journal-trading',
  STORE: 'images',
  available: false,
  cache: new Map(),
  userId: null,
  _db: null,

  key(id){ return this.userId + ':' + id; },

  _open(){
    return new Promise((resolve, reject)=>{
      if(!window.indexedDB) return reject(new Error('sin IndexedDB'));
      const req = indexedDB.open(this.DB, 1);
      req.onupgradeneeded = ()=> req.result.createObjectStore(this.STORE);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  },

  _tx(mode, fn){
    return new Promise((resolve, reject)=>{
      const tx = this._db.transaction(this.STORE, mode);
      const out = fn(tx.objectStore(this.STORE));
      tx.oncomplete = ()=> resolve(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = ()=> reject(tx.error);
      tx.onabort = ()=> reject(tx.error);
    });
  },

  // Abre la base y carga en memoria las imágenes del usuario.
  async init(userId){
    this.userId = userId;
    try{
      this._db = await this._open();
      const prefix = userId + ':';
      await new Promise((resolve, reject)=>{
        const tx = this._db.transaction(this.STORE, 'readonly');
        const range = IDBKeyRange.bound(prefix, prefix + '￿');
        const req = tx.objectStore(this.STORE).openCursor(range);
        req.onsuccess = ()=>{
          const c = req.result;
          if(!c) return resolve();
          this.cache.set(String(c.key).slice(prefix.length), c.value);
          c.continue();
        };
        req.onerror = ()=> reject(req.error);
      });
      this.available = true;
    }catch(e){
      console.warn('Imágenes sin IndexedDB, se guardan dentro del journal.', e);
      this.available = false;
    }
  },

  get(id){ return id ? this.cache.get(id) || null : null; },

  async put(id, dataUrl){
    this.cache.set(id, dataUrl);
    if(this.available) await this._tx('readwrite', s=> s.put(dataUrl, this.key(id)));
  },

  async remove(id){
    if(!id) return;
    this.cache.delete(id);
    if(this.available) await this._tx('readwrite', s=> s.delete(this.key(id))).catch(()=>{});
  },

  async clearUser(){
    const ids = [...this.cache.keys()];
    await Promise.all(ids.map(id=> this.remove(id)));
  },
};

// Imagen de un trade (nuevo formato con imageId, o el viejo con la imagen adentro).
function tradeImage(h){
  return (h && (ImageStore.get(h.imageId) || h.image)) || null;
}
// Solo si la imagen ya está en memoria: antes de que termine ImageStore.init (o si
// se perdió de IndexedDB) el trade tiene imageId pero no hay qué mostrar.
function hasImage(h){
  return !!tradeImage(h);
}
function newImageId(){
  return 'img_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
}
