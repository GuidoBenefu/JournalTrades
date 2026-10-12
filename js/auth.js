// Autenticación y planes con Supabase.
//
// Las páginas leen el usuario de forma sincrónica con `currentUser()`: es una copia
// del perfil guardada en localStorage (`jt_profile`), así la app abre al instante
// y funciona sin conexión. `init()` la confirma contra el servidor al cargar.
//
// El cliente de Supabase solo se crea en las páginas que cargan js/config.js y
// js/vendor/supabase.js (login y app). La landing solo usa la copia local.

const PROFILE_KEY = 'jt_profile';
const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Precios del plan Pro en USD. El anual tiene un 20% de descuento sobre 12 meses.
const PRO_PRICING = {
  monthly: {price: 14.99},
  annual: {price: 143.90, fullYear: 179.88, perMonth: 11.99, discountPct: 20, savings: 35.98},
};

function formatUSD(n){
  // En inglés el decimal es con punto; en español, con coma.
  const en = typeof LANG !== 'undefined' && LANG === 'en';
  return 'USD ' + (en ? n.toFixed(2) : n.toFixed(2).replace('.', ','));
}

function readJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch(e){
    return fallback;
  }
}

function writeJSON(key, value){
  try{
    localStorage.setItem(key, JSON.stringify(value));
  }catch(e){
    throw new Error(t('No se pudo guardar: el almacenamiento del navegador está lleno. Liberá espacio e intentá de nuevo.'));
  }
}

// Error asociado a un campo del formulario, para mostrarlo debajo de ese campo.
function fieldError(field, message){
  const e = new Error(message);
  e.field = field;
  return e;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

// ---- Cliente de Supabase ----
let sbClient = null;
function sb(){
  if(sbClient) return sbClient;
  if(typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL || !SUPABASE_ANON_KEY){
    throw new Error(t('No pudimos conectar con el servidor. Probá de nuevo en un rato.'));
  }
  sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  // Sesión cerrada desde otro lado (logout en otra pestaña, token vencido o revocado).
  sbClient.auth.onAuthStateChange(event=>{
    if(event === 'SIGNED_OUT') localStorage.removeItem(PROFILE_KEY);
  });
  return sbClient;
}

// URL absoluta de una página del sitio, para los links de los emails y de Google.
function pageUrl(path){
  return new URL(path, location.href).href;
}

// Traduce los errores de Supabase Auth a mensajes para el usuario.
function authError(error){
  const code = error && error.code;
  if(code === 'invalid_credentials') return new Error(t('Email o contraseña incorrectos.'));
  if(code === 'email_not_confirmed') return new Error(t('Todavía no confirmaste tu email. Revisá tu casilla (y la carpeta de spam).'));
  if(code === 'user_already_exists' || code === 'email_exists') return fieldError('email', t('Ya existe una cuenta con ese email. Iniciá sesión.'));
  if(code === 'weak_password') return fieldError('password', t('Esa contraseña es muy débil. Probá con una más larga.'));
  if(code === 'same_password') return fieldError('password', t('La contraseña nueva tiene que ser distinta de la anterior.'));
  if(code === 'email_address_invalid') return fieldError('email', t('Ese email no parece válido.'));
  if(code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return new Error(t('Demasiados intentos. Esperá unos minutos y probá de nuevo.'));
  if(error && error.name === 'AuthSessionMissingError') return new Error(t('El link no es válido o ya venció. Pedí uno nuevo.'));
  if(error && (error.name === 'AuthRetryableFetchError' || error.status === 0)) return new Error(t('No pudimos conectar con el servidor. Revisá tu conexión.'));
  console.error('auth error', error);
  return new Error(t('Algo salió mal. Probá de nuevo en un rato.'));
}

// ---- Perfil ----
function toUser(authUser, profile, sub){
  const periodEnd = sub && sub.current_period_ends_at ? Date.parse(sub.current_period_ends_at) : null;
  // Mismo criterio que public.has_access() en supabase/schema.sql.
  const pro = !!sub && (['active', 'trialing', 'past_due'].includes(sub.status) || (sub.status === 'canceled' && periodEnd > Date.now()));
  return {
    id: authUser.id,
    email: authUser.email,
    name: profile.name || String(authUser.email || '').split('@')[0],
    avatarColor: profile.avatar_color || null,
    onboarded: !!profile.onboarded,
    plan: pro ? 'pro' : 'trial',
    billing: pro ? (sub.billing === 'annual' ? 'annual' : 'monthly') : null,
    // Si la canceló, Pro dura hasta el final del período pagado.
    proUntil: pro && sub.status === 'canceled' ? periodEnd : null,
    trialEndsAt: Date.parse(profile.trial_ends_at),
    createdAt: Date.parse(profile.created_at),
  };
}

async function fetchUser(authUser){
  const db = sb();
  const [p, s] = await Promise.all([
    db.from('profiles').select('name, avatar_color, onboarded, trial_ends_at, created_at').eq('id', authUser.id).maybeSingle(),
    db.from('subscriptions').select('status, billing, current_period_ends_at').eq('user_id', authUser.id).maybeSingle(),
  ]);
  if(p.error) throw p.error;
  if(s.error) throw s.error;
  if(!p.data) throw new Error('No existe el perfil de ' + authUser.id + ' (¿falta el trigger de supabase/schema.sql?)');
  return toUser(authUser, p.data, s.data);
}

// Guarda el usuario en la copia local, pasándole antes los datos de una cuenta
// vieja de este navegador si la hay.
async function setCurrentUser(user){
  await adoptLocalAccount(user).catch(e=> console.warn('No se pudieron pasar los datos locales', e));
  writeJSON(PROFILE_KEY, user);
  return user;
}

// Cambia la copia local al instante y manda el cambio al servidor.
function updateCurrentUser(changes){
  const user = readJSON(PROFILE_KEY, null);
  if(!user) return null;
  Object.assign(user, changes);
  writeJSON(PROFILE_KEY, user);
  const row = {};
  if('name' in changes) row.name = changes.name;
  if('avatarColor' in changes) row.avatar_color = changes.avatarColor || null;
  if('onboarded' in changes) row.onboarded = changes.onboarded;
  try{
    sb().from('profiles').update(row).eq('id', user.id)
      .then(({error})=>{ if(error) console.error('No se pudo guardar el perfil', error); });
  }catch(e){
    console.error('No se pudo guardar el perfil', e);
  }
  return user;
}

// ---- Cuentas del navegador (antes de Supabase) ----
// Hasta ahora los usuarios vivían solo en este navegador (`jt_users`). Si hay uno
// con el mismo email, su journal y sus capturas pasan a la cuenta de Supabase,
// salvo que esa cuenta ya tenga un journal en este navegador.
const JOURNAL_KEY_PREFIX = 'tradingChecklistState:'; // STORAGE_KEY de js/storage.js

async function adoptLocalAccount(user){
  const users = readJSON('jt_users', null);
  if(!Array.isArray(users)) return;
  const old = users.find(u=> u && u.email === String(user.email || '').toLowerCase());
  if(!old) return;
  const from = JOURNAL_KEY_PREFIX + old.id, to = JOURNAL_KEY_PREFIX + user.id;
  const data = localStorage.getItem(from);
  if(data && !localStorage.getItem(to)){
    // Se borra antes de copiar para que entre aunque el almacenamiento esté casi lleno.
    localStorage.removeItem(from);
    try{
      localStorage.setItem(to, data);
    }catch(e){
      localStorage.setItem(from, data);
      throw e;
    }
    await moveImages(old.id, user.id);
    // Ya hizo la configuración guiada con ese journal: no se le vuelve a mostrar.
    const changes = {};
    if(old.onboarded !== false && !user.onboarded) changes.onboarded = user.onboarded = true;
    if(old.avatarColor && !user.avatarColor) changes.avatar_color = user.avatarColor = old.avatarColor;
    if(Object.keys(changes).length){
      const {error} = await sb().from('profiles').update(changes).eq('id', user.id);
      if(error) console.error('No se pudo guardar el perfil', error);
    }
  }
  const rest = users.filter(u=> u !== old);
  if(rest.length) writeJSON('jt_users', rest);
  else localStorage.removeItem('jt_users');
  if(!rest.length) localStorage.removeItem('jt_session');
}

// Las capturas están en IndexedDB con la clave `<userId>:<imageId>` (js/images.js).
function moveImages(fromId, toId){
  return new Promise((resolve, reject)=>{
    if(!window.indexedDB) return resolve();
    const req = indexedDB.open('journal-trading', 1);
    req.onupgradeneeded = ()=> req.result.createObjectStore('images');
    req.onerror = ()=> reject(req.error);
    req.onsuccess = ()=>{
      const db = req.result;
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      const prefix = fromId + ':';
      const cursorReq = store.openCursor(IDBKeyRange.bound(prefix, prefix + '￿'));
      cursorReq.onsuccess = ()=>{
        const c = cursorReq.result;
        if(!c) return;
        store.put(c.value, toId + ':' + String(c.key).slice(prefix.length));
        c.delete();
        c.continue();
      };
      tx.oncomplete = ()=>{ db.close(); resolve(); };
      tx.onerror = tx.onabort = ()=>{ db.close(); reject(tx.error); };
    };
  });
}

const JournalAuth = {
  TRIAL_DAYS,
  EMAIL_RE,
  MIN_PASSWORD,
  PRO_PRICING,
  formatUSD,

  // Confirma la sesión contra Supabase y actualiza la copia local. Sin conexión
  // sigue con la copia local; si la sesión ya no existe, la borra.
  async init(){
    let session;
    try{
      const {data, error} = await sb().auth.getSession();
      if(error) throw error;
      session = data.session;
    }catch(e){
      console.warn('Sin conexión con Supabase, se usa la sesión guardada', e);
      return this.currentUser();
    }
    if(!session){
      localStorage.removeItem(PROFILE_KEY);
      return null;
    }
    try{
      return await setCurrentUser(await fetchUser(session.user));
    }catch(e){
      console.warn('No se pudo leer el perfil, se usa el guardado', e);
      return this.currentUser();
    }
  },

  // Devuelve el usuario, o {needsConfirmation: true} si Supabase pide confirmar el email.
  async register({name, email, password}){
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim().slice(0, 40);
    if(!name) throw fieldError('name', t('Ingresá tu nombre.'));
    if(!EMAIL_RE.test(email)) throw fieldError('email', t('Ingresá un email válido.'));
    if(!password || password.length < MIN_PASSWORD) throw fieldError('password', t('La contraseña tiene que tener al menos {n} caracteres.', {n: MIN_PASSWORD}));
    const {data, error} = await sb().auth.signUp({
      email, password,
      options: {data: {name}, emailRedirectTo: pageUrl('auth.html')},
    });
    if(error) throw authError(error);
    // Con la confirmación de email activada, un email ya registrado vuelve sin
    // identidades (Supabase no lo marca como error para no revelar cuentas).
    if(data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0){
      throw fieldError('email', t('Ya existe una cuenta con ese email. Iniciá sesión.'));
    }
    if(!data.session) return {needsConfirmation: true};
    return setCurrentUser(await fetchUser(data.user));
  },

  async login({email, password}){
    email = String(email || '').trim().toLowerCase();
    const {data, error} = await sb().auth.signInWithPassword({email, password: password || ''});
    if(error) throw authError(error);
    return setCurrentUser(await fetchUser(data.user));
  },

  // Lleva a Google y vuelve a auth.html con la sesión iniciada.
  async loginWithGoogle(){
    const {error} = await sb().auth.signInWithOAuth({provider: 'google', options: {redirectTo: pageUrl('auth.html')}});
    if(error) throw authError(error);
  },

  // Manda el email con el link para crear una contraseña nueva (vuelve a auth.html?mode=update).
  async requestPasswordReset(email){
    email = String(email || '').trim().toLowerCase();
    const {error} = await sb().auth.resetPasswordForEmail(email, {redirectTo: pageUrl('auth.html?mode=update')});
    if(error) throw authError(error);
  },

  // Después de entrar por el link del email.
  async updatePassword(password){
    if(!password || password.length < MIN_PASSWORD) throw fieldError('password', t('La contraseña tiene que tener al menos {n} caracteres.', {n: MIN_PASSWORD}));
    const {data, error} = await sb().auth.updateUser({password});
    if(error) throw authError(error);
    return setCurrentUser(await fetchUser(data.user));
  },

  async logout(){
    localStorage.removeItem(PROFILE_KEY);
    try{
      await sb().auth.signOut({scope: 'local'});
    }catch(e){
      console.warn('No se pudo cerrar la sesión en el servidor', e);
    }
  },

  currentUser(){
    return readJSON(PROFILE_KEY, null);
  },

  trialDaysLeft(user){
    if(!user || user.plan !== 'trial' || !user.trialEndsAt) return 0;
    return Math.max(0, Math.ceil((user.trialEndsAt - Date.now()) / DAY_MS));
  },

  hasAccess(user){
    if(!user) return false;
    if(user.plan === 'pro') return !user.proUntil || Date.now() < user.proUntil;
    return Date.now() < user.trialEndsAt;
  },

  // El pago lo va a confirmar el webhook de Paddle, que escribe en `subscriptions`.
  async checkout(billing){
    throw new Error(t('Los pagos se activan muy pronto. Mientras tanto, tus datos siguen guardados.'));
  },

  // Las cuentas creadas antes de la configuración guiada no tienen el campo.
  needsOnboarding(user){
    return !!user && user.onboarded === false;
  },

  completeOnboarding(){
    return updateCurrentUser({onboarded: true});
  },

  // Datos editables del perfil: nombre y color del avatar.
  updateProfile({name, avatarColor}){
    const changes = {};
    if(name !== undefined){
      name = String(name).trim();
      if(!name) throw fieldError('name', t('Ingresá tu nombre.'));
      changes.name = name.slice(0, 40);
    }
    if(avatarColor !== undefined) changes.avatarColor = avatarColor;
    return updateCurrentUser(changes);
  },
};
