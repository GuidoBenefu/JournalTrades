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
  else document.getElementById('paywall').style.display = 'none';
}

const pricing = JournalAuth.PRO_PRICING;
document.getElementById('pwMonthly').textContent = JournalAuth.formatUSD(pricing.monthly.price);
document.getElementById('pwAnnual').textContent = JournalAuth.formatUSD(pricing.annual.price);
document.getElementById('pwAnnualSub').textContent = 'por año · ' + JournalAuth.formatUSD(pricing.annual.perMonth) + '/mes';

// expired: la prueba terminó y no se puede cerrar sin pasar a Pro.
function openUpgrade(expired){
  document.getElementById('paywallIcon').innerHTML = Icons.svg(expired ? 'hourglass' : 'rocket', 26);
  document.getElementById('paywallTitle').textContent = expired ? 'Tu prueba gratis terminó' : 'Pasate a Pro';
  document.getElementById('paywallText').textContent = expired
    ? 'Pasate a Pro para seguir registrando trades. Tus datos siguen guardados.'
    : 'Seguí entrenando tu disciplina sin límite de tiempo.';
  document.getElementById('paywallCloseBtn').style.display = expired ? 'none' : '';
  document.getElementById('paywall').style.display = 'flex';
}

document.querySelectorAll('.billing-card').forEach(btn=>{
  btn.addEventListener('click', ()=> renderSession(JournalAuth.upgradeToPro(btn.dataset.billing)));
});
document.getElementById('paywallCloseBtn').addEventListener('click', ()=>{
  document.getElementById('paywall').style.display = 'none';
});

function logout(){
  JournalAuth.logout();
  location.href = 'index.html';
}

document.getElementById('upgradeBtn').addEventListener('click', ()=> openUpgrade(false));
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('logoutBtnMobile').addEventListener('click', logout);
document.getElementById('paywallLogoutBtn').addEventListener('click', logout);

renderSession(sessionUser);
