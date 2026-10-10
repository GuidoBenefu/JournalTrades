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
  {id: 'first_trade', icon: 'rocket', title: 'Primer paso', desc: 'Registraste tu primer trade.', test: ()=> state.history.length >= 1},
  {id: 'trades_10', icon: 'book', title: 'Constante', desc: 'Registraste 10 trades.', test: ()=> state.history.length >= 10},
  {id: 'trades_50', icon: 'library', title: 'Disciplina de journal', desc: 'Registraste 50 trades.', test: ()=> state.history.length >= 50},
  {id: 'trades_100', icon: 'landmark', title: 'Centenario', desc: 'Registraste 100 trades.', test: ()=> state.history.length >= 100},
  {id: 'streak_5', icon: 'flame', title: 'Racha de 5', desc: '5 trades seguidos respetando tu plan.', test: ()=> state.bestStreak >= 5},
  {id: 'streak_10', icon: 'zap', title: 'Racha de 10', desc: '10 trades seguidos respetando tu plan.', test: ()=> state.bestStreak >= 10},
  {id: 'streak_25', icon: 'gem', title: 'Racha de 25', desc: '25 trades seguidos respetando tu plan.', test: ()=> state.bestStreak >= 25},
  {id: 'streak_50', icon: 'bot', title: 'Máquina', desc: '50 trades seguidos respetando tu plan.', test: ()=> state.bestStreak >= 50},
  {id: 'clean_10', icon: 'check-check', title: 'Sin errores', desc: '10 trades seguidos sin marcar errores.', test: ()=>{
    let run = 0, best = 0;
    Analytics.chronological().forEach(h=>{ run = (h.errors && h.errors.length) ? 0 : run + 1; best = Math.max(best, run); });
    return best >= 10;
  }},
  {id: 'clean_week', icon: 'sparkles', title: 'Semana perfecta', desc: 'Una semana con 3 trades o más y el plan siempre respetado.', test: ()=>{
    const weeks = {};
    state.history.forEach(h=>{ const k = Analytics.weekKey(h.ts); (weeks[k] = weeks[k] || []).push(h); });
    return Object.values(weeks).some(w=> w.length >= 3 && w.every(h=> h.followedPlan));
  }},
  {id: 'goal_month', icon: 'trophy', title: 'Meta cumplida', desc: 'Cumpliste tu meta de disciplina en un mes (con 10 trades o más y una meta de 70% o más).', test: ()=>{
    const months = [...new Set(state.history.map(h=> monthKeyOf(h.ts)))];
    return months.some(m=>{ const r = monthPlanPct(m); return r.n >= 10 && r.pct >= goalTarget(); });
  }},
  {id: 'first_review', icon: 'lightbulb', title: 'Autoconocimiento', desc: 'Completaste tu primera revisión semanal.', test: ()=> Object.keys(state.reviews || {}).length >= 1},
  {id: 'reviews_4', icon: 'calendar-check', title: 'Un mes de revisiones', desc: 'Completaste 4 revisiones semanales.', test: ()=> Object.keys(state.reviews || {}).length >= 4},
];

function showToast(html){
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = html;
  box.appendChild(t);
  setTimeout(()=> t.classList.add('out'), 4200);
  setTimeout(()=> t.remove(), 4700);
}

// silent: al cargar la app no se muestran avisos de logros que ya se cumplían.
// Los logros se recalculan con el historial: si borrás los trades que lo
// desbloquearon, el logro vuelve a quedar bloqueado (sin aviso).
function checkAchievements(silent){
  let changed = false;
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
    if(!silent) showToast(`<span class="toast-ic">${Icons.svg(a.icon, 22)}</span><div><b>¡Logro desbloqueado!</b><br>${a.title}: ${a.desc}</div>`);
  });
  if(changed) saveState();
}

document.getElementById('goalPlanInput').value = goalPct();
document.getElementById('goalPlanInput').addEventListener('change', e=>{
  const v = Math.round(Number(String(e.target.value).replace(',', '.')));
  state.goals.planPct = v > 0 && v <= 100 ? v : 80;
  e.target.value = state.goals.planPct;
  saveState();
  renderAll();
});

onDataChange.push(()=> checkAchievements(false));
checkAchievements(true);
