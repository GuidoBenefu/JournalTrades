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

function publicUser(u){
  if(!u) return null;
  const {passwordHash, ...rest} = u;
  return rest;
}

const JournalAuth = {
  TRIAL_DAYS,

  async register({name, email, password, plan}){
    email = String(email || '').trim().toLowerCase();
    name = String(name || '').trim();
    if(!name) throw new Error('Ingresá tu nombre.');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ingresá un email válido.');
    if(!password || password.length < 6) throw new Error('La contraseña tiene que tener al menos 6 caracteres.');
    const users = readJSON(USERS_KEY, []);
    if(users.some(u=>u.email === email)) throw new Error('Ya existe una cuenta con ese email. Iniciá sesión.');
    const now = Date.now();
    const user = {
      id: 'u_' + now + '_' + Math.floor(Math.random()*10000),
      name,
      email,
      passwordHash: await hashPassword(password),
      plan: plan === 'pro' ? 'pro' : 'trial',
      trialEndsAt: plan === 'pro' ? null : now + TRIAL_DAYS * DAY_MS,
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
  upgradeToPro(){
    const session = readJSON(SESSION_KEY, null);
    if(!session) return null;
    const users = readJSON(USERS_KEY, []);
    const user = users.find(u=>u.id === session.userId);
    if(!user) return null;
    user.plan = 'pro';
    user.trialEndsAt = null;
    writeJSON(USERS_KEY, users);
    return publicUser(user);
  },
};
