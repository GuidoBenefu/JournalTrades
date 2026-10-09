// Autenticación y planes, simulados en localStorage.
//
// No hay servidor todavía: los usuarios y la sesión viven en este navegador.
// Sirve para armar el flujo de la SaaS (registro, login, prueba gratis, Pro).
// Cuando haya backend, se reemplaza el cuerpo de estas funciones por llamadas
// a la API sin cambiar cómo las usan las páginas.

const USERS_KEY = 'jt_users';
const SESSION_KEY = 'jt_session';
const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// Precios del plan Pro en USD. El anual tiene un 20% de descuento sobre 12 meses.
const PRO_PRICING = {
  monthly: {price: 14.99},
  annual: {price: 143.90, fullYear: 179.88, perMonth: 11.99, discountPct: 20, savings: 35.98},
};

function formatUSD(n){
  return 'USD ' + n.toFixed(2).replace('.', ',');
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
  localStorage.setItem(key, JSON.stringify(value));
}

async function hashPassword(password){
  // Solo para no dejar la contraseña en texto plano en el mock. La seguridad real
  // la va a dar el backend.
  if(window.crypto && crypto.subtle){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  return 'plain:' + btoa(unescape(encodeURIComponent(password)));
}

// Error asociado a un campo del formulario, para mostrarlo debajo de ese campo.
function fieldError(field, message){
  const e = new Error(message);
  e.field = field;
  return e;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

function publicUser(u){
  if(!u) return null;
  const {passwordHash, ...rest} = u;
  return rest;
}

// Guarda cambios en el usuario de la sesión actual.
function updateCurrentUser(changes){
  const session = readJSON(SESSION_KEY, null);
  if(!session) return null;
  const users = readJSON(USERS_KEY, []);
  const user = users.find(u=>u.id === session.userId);
  if(!user) return null;
  Object.assign(user, changes);
  writeJSON(USERS_KEY, users);
  return publicUser(user);
}

const JournalAuth = {
  TRIAL_DAYS,
  EMAIL_RE,
  MIN_PASSWORD,
  PRO_PRICING,
  formatUSD,

  async register({name, email, password, plan, billing}){
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim();
    if(!name) throw fieldError('name', 'Ingresá tu nombre.');
    if(!EMAIL_RE.test(email)) throw fieldError('email', 'Ingresá un email válido.');
    if(!password || password.length < MIN_PASSWORD) throw fieldError('password', 'La contraseña tiene que tener al menos ' + MIN_PASSWORD + ' caracteres.');
    const users = readJSON(USERS_KEY, []);
    if(users.some(u=>u.email === email)) throw fieldError('email', 'Ya existe una cuenta con ese email. Iniciá sesión.');
    const now = Date.now();
    const user = {
      id: 'u_' + now + '_' + Math.floor(Math.random()*10000),
      name,
      email,
      passwordHash: await hashPassword(password),
      plan: plan === 'pro' ? 'pro' : 'trial',
      trialEndsAt: plan === 'pro' ? null : now + TRIAL_DAYS * DAY_MS,
      billing: plan === 'pro' ? (billing === 'annual' ? 'annual' : 'monthly') : null,
      // Las cuentas nuevas pasan por la configuración guiada al entrar a la app.
      onboarded: false,
      createdAt: now,
    };
    users.push(user);
    writeJSON(USERS_KEY, users);
    writeJSON(SESSION_KEY, {userId: user.id, at: now});
    return publicUser(user);
  },

  async login({email, password}){
    email = String(email || '').trim().toLowerCase();
    const users = readJSON(USERS_KEY, []);
    const user = users.find(u=>u.email === email);
    if(!user || user.passwordHash !== await hashPassword(password || '')){
      throw new Error('Email o contraseña incorrectos.');
    }
    writeJSON(SESSION_KEY, {userId: user.id, at: Date.now()});
    return publicUser(user);
  },

  logout(){
    localStorage.removeItem(SESSION_KEY);
  },

  currentUser(){
    const session = readJSON(SESSION_KEY, null);
    if(!session) return null;
    return publicUser(readJSON(USERS_KEY, []).find(u=>u.id === session.userId));
  },

  trialDaysLeft(user){
    if(!user || user.plan !== 'trial' || !user.trialEndsAt) return 0;
    return Math.max(0, Math.ceil((user.trialEndsAt - Date.now()) / DAY_MS));
  },

  hasAccess(user){
    if(!user) return false;
    if(user.plan === 'pro') return true;
    return Date.now() < user.trialEndsAt;
  },

  // Simula el pago: cuando haya pasarela de pagos, esto lo confirma el backend.
  upgradeToPro(billing){
    return updateCurrentUser({plan: 'pro', billing: billing === 'annual' ? 'annual' : 'monthly', trialEndsAt: null});
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
      if(!name) throw fieldError('name', 'Ingresá tu nombre.');
      changes.name = name.slice(0, 40);
    }
    if(avatarColor !== undefined) changes.avatarColor = avatarColor;
    return updateCurrentUser(changes);
  },
};
