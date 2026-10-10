// Meta mensual de disciplina y logros. Un logro se desbloquea una sola vez y
// queda guardado en state.achievements con la fecha.

function currentStreak(){
  let streak = 0;
  for(const h of state.history){
    if(h.followedPlan) streak++;
    else break;
  }
  return streak;
}

function monthPlanPct(monthKey){
  const list = state.history.filter(h=> monthKeyOf(h.ts) === monthKey);
  return {n: list.length, pct: list.length ? list.filter(h=> h.followedPlan).length / list.length * 100 : 0};
}

function goalPct(){
  const v = Number(state.goals && state.goals.planPct);
  return v > 0 && v <= 100 ? v : 80;
}

// Para el logro "Meta cumplida" la meta cuenta como mínimo 70%: bajarla no lo regala.
function goalTarget(){
  return Math.max(goalPct(), 70);
}

const ACHIEVEMENTS = [
  {id: 'first_trade', icon: 'rocket', title: t('Primer paso'), desc: t('Registraste tu primer trade.'), test: ()=> state.history.length >= 1},
  {id: 'trades_10', icon: 'book', title: t('Constante'), desc: t('Registraste 10 trades.'), test: ()=> state.history.length >= 10},
  {id: 'trades_50', icon: 'library', title: t('Disciplina de journal'), desc: t('Registraste 50 trades.'), test: ()=> state.history.length >= 50},
  {id: 'trades_100', icon: 'landmark', title: t('Centenario'), desc: t('Registraste 100 trades.'), test: ()=> state.history.length >= 100},
  {id: 'streak_5', icon: 'flame', title: t('Racha de 5'), desc: t('5 trades seguidos respetando tu plan.'), test: ()=> state.bestStreak >= 5},
  {id: 'streak_10', icon: 'zap', title: t('Racha de 10'), desc: t('10 trades seguidos respetando tu plan.'), test: ()=> state.bestStreak >= 10},
  {id: 'streak_25', icon: 'gem', title: t('Racha de 25'), desc: t('25 trades seguidos respetando tu plan.'), test: ()=> state.bestStreak >= 25},
  {id: 'streak_50', icon: 'bot', title: t('Máquina'), desc: t('50 trades seguidos respetando tu plan.'), test: ()=> state.bestStreak >= 50},
  {id: 'clean_10', icon: 'check-check', title: t('Sin errores'), desc: t('10 trades seguidos sin marcar errores.'), test: ()=>{
    let run = 0, best = 0;
    Analytics.chronological().forEach(h=>{ run = (h.errors && h.errors.length) ? 0 : run + 1; best = Math.max(best, run); });
    return best >= 10;
  }},
  {id: 'clean_week', icon: 'sparkles', title: t('Semana perfecta'), desc: t('Una semana con 3 trades o más y el plan siempre respetado.'), test: ()=>{
    const weeks = {};
    state.history.forEach(h=>{ const k = Analytics.weekKey(h.ts); (weeks[k] = weeks[k] || []).push(h); });
    return Object.values(weeks).some(w=> w.length >= 3 && w.every(h=> h.followedPlan));
  }},
  {id: 'goal_month', icon: 'trophy', title: t('Meta cumplida'), desc: t('Cumpliste tu meta de disciplina en un mes (con 10 trades o más y una meta de 70% o más).'), test: ()=>{
    const months = [...new Set(state.history.map(h=> monthKeyOf(h.ts)))];
    return months.some(m=>{ const r = monthPlanPct(m); return r.n >= 10 && r.pct >= goalTarget(); });
  }},
  {id: 'first_review', icon: 'lightbulb', title: t('Autoconocimiento'), desc: t('Completaste tu primera revisión semanal.'), test: ()=> Object.keys(state.reviews || {}).length >= 1},
  {id: 'reviews_4', icon: 'calendar-check', title: t('Un mes de revisiones'), desc: t('Completaste 4 revisiones semanales.'), test: ()=> Object.keys(state.reviews || {}).length >= 4},
];

function showToast(html){
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  box.appendChild(el);
  setTimeout(()=> el.classList.add('out'), 4200);
  setTimeout(()=> el.remove(), 4700);
}

// silent: al cargar la app no se muestran avisos de logros que ya se cumplían.
// Los logros se recalculan con el historial: si borrás los trades que lo
// desbloquearon, el logro vuelve a quedar bloqueado (sin aviso).
function checkAchievements(silent){
  let changed = false;
  const unlocked = [];
  ACHIEVEMENTS.forEach(a=>{
    let ok = false;
    try{ ok = a.test(); }catch(e){ ok = false; }
    if(state.achievements[a.id]){
      if(!ok){ delete state.achievements[a.id]; changed = true; }
      return;
    }
    if(!ok) return;
    state.achievements[a.id] = Date.now();
    changed = true;
    unlocked.push(a);
  });
  if(!silent && unlocked.length){
    // Si se desbloquean varios a la vez, un solo aviso para no tapar la pantalla.
    if(unlocked.length <= 2) unlocked.forEach(a=> showToast(`<span class="toast-ic">${Icons.svg(a.icon, 22)}</span><div><b>${t('¡Logro desbloqueado!')}</b><br>${a.title}: ${a.desc}</div>`));
    else showToast(`<span class="toast-ic">${Icons.svg('trophy', 22)}</span><div><b>${t('¡Desbloqueaste {n} logros!', {n: unlocked.length})}</b><br>${unlocked.map(a=> a.title).join(', ')}.</div>`);
  }
  if(changed) saveState();
}

document.getElementById('goalPlanInput').addEventListener('change', e=>{
  const v = Math.round(Number(String(e.target.value).replace(',', '.')));
  state.goals.planPct = v > 0 && v <= 100 ? v : 80;
  e.target.value = state.goals.planPct;
  saveState();
  renderAll();
});

onDataChange.push(()=> checkAchievements(false));
checkAchievements(true);
