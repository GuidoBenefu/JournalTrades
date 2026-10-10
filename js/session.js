// Sesión del usuario dentro de la app: datos del header, plan, paywall y logout.
// Corre antes de app.js para que el journal cargue los datos del usuario logueado.

const sessionUser = JournalAuth.currentUser();
if(sessionUser) JournalStore.setUser(sessionUser.id);

// Colores del avatar: fondo y texto, legibles en modo claro y oscuro.
const AVATAR_COLORS = {
  green: ['#10e88c', '#06281a'],
  blue: ['#4f8cff', '#04163a'],
  violet: ['#a78bfa', '#1e0f45'],
  amber: ['#f5b041', '#3a2400'],
  rose: ['#f472b6', '#3d0722'],
  slate: ['#94a3b8', '#0f1720'],
};

function initialsOf(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

function paintAvatar(el, user){
  el.textContent = initialsOf(user.name);
  const c = AVATAR_COLORS[user.avatarColor];
  el.style.background = c ? c[0] : '';
  el.style.color = c ? c[1] : '';
}

function renderSession(user){
  if(!user) return;
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;
  paintAvatar(document.getElementById('userAvatar'), user);

  const badge = document.getElementById('planBadge');
  const upgradeBtn = document.getElementById('upgradeBtn');
  if(user.plan === 'pro'){
    badge.textContent = user.billing === 'annual' ? 'Pro · anual' : 'Pro · mensual';
    badge.className = 'planbadge pro';
    upgradeBtn.style.display = 'none';
  } else {
    const days = JournalAuth.trialDaysLeft(user);
    // En celular se oculta "Prueba gratis · " para que entre en la barra.
    badge.innerHTML = days > 0
      ? '<span class="desktop-only">Prueba gratis · </span>' + (days === 1 ? 'queda 1 día' : 'quedan ' + days + ' días')
      : 'Prueba terminada';
    badge.className = 'planbadge ' + (days > 2 ? 'trial' : 'ending');
    upgradeBtn.style.display = '';
  }
  if(!JournalAuth.hasAccess(user)) openUpgrade(true);
  else if(paywallExpired) closePaywall();
}

const pricing = JournalAuth.PRO_PRICING;
document.getElementById('pwMonthly').textContent = JournalAuth.formatUSD(pricing.monthly.price);
document.getElementById('pwAnnual').textContent = JournalAuth.formatUSD(pricing.annual.price);
document.getElementById('pwAnnualSub').textContent = 'por año · ' + JournalAuth.formatUSD(pricing.annual.perMonth) + '/mes';

// expired: la prueba terminó y no se puede cerrar sin pasar a Pro.
let paywallExpired = false;
function openUpgrade(expired){
  paywallExpired = !!expired;
  document.getElementById('paywallIcon').innerHTML = Icons.svg(expired ? 'hourglass' : 'rocket', 26);
  document.getElementById('paywallTitle').textContent = expired ? 'Tu prueba gratis terminó' : 'Pasate a Pro';
  document.getElementById('paywallText').textContent = expired
    ? 'Pasate a Pro para seguir registrando trades. Tus datos siguen guardados.'
    : 'Seguí entrenando tu disciplina sin límite de tiempo.';
  document.getElementById('paywallCloseBtn').style.display = expired ? 'none' : '';
  document.getElementById('paywallExportBtn').style.display = expired ? '' : 'none';
  document.getElementById('paywall').style.display = 'flex';
  // La app de atrás queda bloqueada también para el teclado.
  document.querySelector('.appshell').inert = true;
  const first = document.querySelector('#paywall .billing-card');
  if(first) first.focus();
}

function closePaywall(){
  paywallExpired = false;
  document.getElementById('paywall').style.display = 'none';
  document.querySelector('.appshell').inert = false;
}

document.querySelectorAll('.billing-card').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const user = JournalAuth.upgradeToPro(btn.dataset.billing);
    closePaywall();
    renderSession(user);
    if(typeof renderProfile === 'function') renderProfile();
    if(typeof showToast === 'function') showToast(`<span class="toast-ic">${Icons.svg('sparkles', 22)}</span><div><b>¡Listo, ya sos Pro!</b><br>Seguí registrando tus trades sin límite.</div>`);
    // Si la prueba venció antes de terminar la configuración guiada, se muestra ahora.
    if(JournalAuth.needsOnboarding(user) && typeof openOnboarding === 'function') openOnboarding();
  });
});
document.getElementById('paywallCloseBtn').addEventListener('click', closePaywall);
document.getElementById('paywallExportBtn').addEventListener('click', ()=>{
  if(typeof stateForExport === 'function') JournalStore.exportToFile(stateForExport());
});

function logout(){
  JournalAuth.logout();
  location.replace('index.html');
}

// Si la sesión cambió en otra pestaña (logout o login con otra cuenta), esta
// pestaña se recarga para no mezclar datos de dos usuarios.
function checkSessionStillValid(){
  const u = JournalAuth.currentUser();
  if(!u || !sessionUser || u.id !== sessionUser.id){ location.replace(u ? 'app.html' : 'auth.html?mode=login'); return; }
  renderSession(u);
}
window.addEventListener('storage', e=>{ if(e.key === 'jt_session' || e.key === 'jt_users') checkSessionStillValid(); });
// Al volver con "Atrás" después de cerrar sesión, el navegador puede mostrar la página guardada.
window.addEventListener('pageshow', e=>{ if(e.persisted) checkSessionStillValid(); });
// El vencimiento de la prueba se revisa también con la app abierta.
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkSessionStillValid(); });
setInterval(checkSessionStillValid, 60000);

document.getElementById('upgradeBtn').addEventListener('click', ()=> openUpgrade(false));
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('logoutBtnMobile').addEventListener('click', logout);
document.getElementById('paywallLogoutBtn').addEventListener('click', logout);
document.getElementById('obLogout').addEventListener('click', logout);

renderSession(sessionUser);
