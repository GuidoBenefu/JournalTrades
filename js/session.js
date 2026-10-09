// Sesión del usuario dentro de la app: datos del header, plan, paywall y logout.
// Corre antes de app.js para que el journal cargue los datos del usuario logueado.

const sessionUser = JournalAuth.currentUser();
if(sessionUser) JournalStore.setUser(sessionUser.id);

function renderSession(user){
  if(!user) return;
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userEmail').textContent = user.email;
  document.getElementById('userAvatar').textContent = user.name.trim().charAt(0).toUpperCase();

  const badge = document.getElementById('planBadge');
  const upgradeBtn = document.getElementById('upgradeBtn');
  if(user.plan === 'pro'){
    badge.textContent = 'Pro';
    badge.className = 'planbadge pro';
    upgradeBtn.style.display = 'none';
  } else {
    const days = JournalAuth.trialDaysLeft(user);
    badge.textContent = days > 0
      ? 'Prueba gratis · ' + (days === 1 ? 'queda 1 día' : 'quedan ' + days + ' días')
      : 'Prueba terminada';
    badge.className = 'planbadge ' + (days > 2 ? 'trial' : 'ending');
    upgradeBtn.style.display = '';
  }
  document.getElementById('paywall').style.display = JournalAuth.hasAccess(user) ? 'none' : 'flex';
}

function upgrade(){
  if(!confirm('Los pagos todavía no están integrados: el plan Pro se activa sin cobro. ¿Continuar?')) return;
  renderSession(JournalAuth.upgradeToPro());
}

function logout(){
  JournalAuth.logout();
  location.href = 'index.html';
}

document.getElementById('upgradeBtn').addEventListener('click', upgrade);
document.getElementById('paywallUpgradeBtn').addEventListener('click', upgrade);
document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('logoutBtnMobile').addEventListener('click', logout);
document.getElementById('paywallLogoutBtn').addEventListener('click', logout);

renderSession(sessionUser);
