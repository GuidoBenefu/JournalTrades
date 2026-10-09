// Capa de persistencia del journal.
//
// Hoy guarda todo en localStorage (un solo objeto JSON). app.js solo habla con
// `JournalStore`, así que para la versión SaaS alcanza con escribir otro adapter
// (por ejemplo uno que llame a una API REST) y asignarlo en `JournalStore.adapter`.

const STORAGE_KEY = 'tradingChecklistState';
const SCHEMA_VERSION = 1;

// Cada usuario tiene su propio journal bajo `tradingChecklistState:<userId>`.
// Una cuenta nueva siempre arranca vacía: no se adoptan datos de otras claves.
const LocalStorageAdapter = {
  userId: null,
  key(){
    return STORAGE_KEY + ':' + this.userId;
  },
  load(){
    const raw = localStorage.getItem(this.key());
    return raw ? JSON.parse(raw) : null;
  },
  save(data){
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
};

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

const JournalStore = {
  adapter: LocalStorageAdapter,
  onSaveError: null,

  setUser(userId){
    this.adapter.userId = userId;
  },

  load(){
    try{
      const data = this.adapter.load();
      return data ? migrate(data) : null;
    }catch(e){
      console.error('load error', e);
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
    a.download = 'journal-trades-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  parseImport(text){
    const data = JSON.parse(text);
    if(!data || typeof data !== 'object' || !Array.isArray(data.history)){
      throw new Error('El archivo no parece un backup del journal.');
    }
    if((data.schemaVersion || 0) > SCHEMA_VERSION){
      throw new Error('El backup es de una versión más nueva de la app.');
    }
    delete data.exportedAt;
    return migrate(data);
  },
};
