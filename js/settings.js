// Pestaña Ajustes: perfil, botones rápidos de metas y riesgo, y aviso de "Guardado".

// ---- Perfil ----
function renderProfile(){
  const user = JournalAuth.currentUser();
  if(!user) return;
  paintAvatar(document.getElementById('profileAvatar'), user);
  const nameInput = document.getElementById('profileNameInput');
  if(document.activeElement !== nameInput) nameInput.value = user.name;
  document.getElementById('profileEmail').textContent = user.email;

  const current = AVATAR_COLORS[user.avatarColor] ? user.avatarColor : null;
  document.getElementById('avatarSwatches').innerHTML =
    `<button type="button" class="swatch swatch-default ${current ? '' : 'active'}" data-c="" aria-label="Color por defecto"></button>` +
    Object.entries(AVATAR_COLORS).map(([k, c])=>
      `<button type="button" class="swatch ${current === k ? 'active' : ''}" data-c="${k}" style="background:${c[0]}" aria-label="Color ${k}"></button>`).join('');
  document.querySelectorAll('#avatarSwatches .swatch').forEach(b=> b.addEventListener('click', ()=>{
    const u = JournalAuth.updateProfile({avatarColor: b.dataset.c || null});
    renderSession(u);
    renderProfile();
    if(typeof renderHome === 'function') renderOrDefer(renderHome);
    flashSaved();
  }));

  const since = user.createdAt ? new Date(user.createdAt).toLocaleDateString('es-AR', {month: 'long', year: 'numeric'}) : null;
  const box = document.getElementById('profilePlan');
  if(user.plan === 'pro'){
    const annual = user.billing === 'annual';
    const price = JournalAuth.formatUSD(annual ? JournalAuth.PRO_PRICING.annual.price : JournalAuth.PRO_PRICING.monthly.price);
    box.className = 'plan-box pro';
    box.innerHTML = `<div class="pb-top"><div><div class="pb-l">Tu plan</div><div class="pb-v">${Icons.svg('sparkles', 16)} Pro · ${annual ? 'anual' : 'mensual'}</div></div>
      <span class="pb-price">${price}${annual ? '/año' : '/mes'}</span></div>
      ${since ? `<div class="pb-sub">Miembro desde ${since}.</div>` : ''}`;
  } else {
    const days = JournalAuth.trialDaysLeft(user);
    const pct = Math.min(100, days / JournalAuth.TRIAL_DAYS * 100);
    box.className = 'plan-box ' + (days > 2 ? 'trial' : 'ending');
    box.innerHTML = `<div class="pb-top"><div><div class="pb-l">Tu plan</div><div class="pb-v">Prueba gratis</div></div>
      <button type="button" class="primary small" id="profileUpgradeBtn">Pasar a Pro</button></div>
      <div class="pb-bar"><div style="width:${pct}%"></div></div>
      <div class="pb-sub">${days > 0 ? (days === 1 ? 'Te queda 1 día de prueba.' : `Te quedan ${days} días de prueba.`) : 'Tu prueba terminó.'}${since ? ` Miembro desde ${since}.` : ''}</div>`;
    document.getElementById('profileUpgradeBtn').addEventListener('click', ()=> openUpgrade(false));
  }
}

document.getElementById('profileNameInput').addEventListener('change', e=>{
  try{
    const u = JournalAuth.updateProfile({name: e.target.value});
    renderSession(u);
    renderProfile();
    if(typeof renderHome === 'function') renderOrDefer(renderHome);
    flashSaved();
  }catch(err){
    e.target.value = JournalAuth.currentUser().name;
  }
});
document.getElementById('profileNameInput').addEventListener('keydown', e=>{
  if(e.key === 'Enter') e.target.blur();
});

// ---- Meta del mes ----
function renderGoalPreview(){
  const goal = goalPct();
  document.getElementById('goalPlanInput').value = goal;
  document.querySelectorAll('#goalQuick button').forEach(b=> b.classList.toggle('active', Number(b.dataset.v) === goal));
  const r = monthPlanPct(monthKeyOf(Date.now()));
  const box = document.getElementById('goalPreview');
  if(!r.n){ box.className = 'goal-preview'; box.innerHTML = `Todavía no registraste trades este mes. La meta es que el <b>${goal}%</b> respete tu plan.`; return; }
  const inPlan = Math.round(r.pct / 100 * r.n);
  const g = goal / 100;
  let msg, cls;
  if(r.pct >= goal){ cls = 'good'; msg = 'Vas cumpliendo la meta. Mantenela hasta fin de mes.'; }
  else if(g >= 1){ cls = 'bad'; msg = 'Este mes ya no se puede llegar al 100%.'; }
  else {
    const k = Math.ceil((g * r.n - inPlan) / (1 - g) - 1e-9);
    cls = 'warn'; msg = `Te faltan <b>${k}</b> ${k === 1 ? 'trade seguido' : 'trades seguidos'} respetando el plan para llegar.`;
  }
  box.className = 'goal-preview ' + cls;
  box.innerHTML = `<div class="gp-bar"><div style="width:${Math.min(100, r.pct)}%"></div><i style="left:${goal}%"></i></div>
    <div class="gp-txt">Este mes vas <b>${Math.round(r.pct)}%</b> (${inPlan}/${r.n}) · ${msg}</div>`;
}

document.querySelectorAll('#goalQuick button').forEach(b=> b.addEventListener('click', ()=>{
  const inp = document.getElementById('goalPlanInput');
  inp.value = b.dataset.v;
  inp.dispatchEvent(new Event('change'));
}));

// ---- Riesgo diario ----
function renderRiskQuick(){
  const v = getMaxDailyRisk();
  document.querySelectorAll('#riskQuick button').forEach(b=> b.classList.toggle('active', Number(b.dataset.v) === v));
}
document.querySelectorAll('#riskQuick button').forEach(b=> b.addEventListener('click', ()=>{
  const inp = document.getElementById('maxDailyRiskInput');
  inp.value = b.dataset.v;
  inp.dispatchEvent(new Event('input'));
}));

// ---- Horarios ----
function renderTimePrefs(){
  const p = timePrefs();
  document.querySelectorAll('#tzDisplayPills button').forEach(b=> b.classList.toggle('active', b.dataset.v === p.display));
  document.querySelectorAll('#dayEndPills button').forEach(b=> b.classList.toggle('active', Number(b.dataset.v) === p.dayEnd));
  const now = Date.now();
  document.getElementById('tzDisplayHint').textContent = localIsNy(now)
    ? 'Tu hora local coincide con la de Nueva York.'
    : `Ahora son las ${fmtTime(now, NY_TZ)} en Nueva York y las ${fmtTime(now, LOCAL_TZ)} en tu zona (${LOCAL_TZ.replace(/_/g, ' ')}).`;
  document.getElementById('dayEndHint').textContent = p.dayEnd
    ? 'Lo que operes desde las 17:00 de NY cuenta para el día siguiente, como el cierre de forex y futuros.'
    : 'Cada día va de 00:00 a 23:59 en hora de Nueva York.';
}
// Cambiar los horarios no toca los trades: solo cómo se agrupan y se muestran.
function setTimePref(key, value){
  state.timePrefs = {...timePrefs(), [key]: value};
  saveState();
  renderTimePrefs();
  if(!editingTradeId && !entryTimeTouched) document.getElementById('entryTimeInput').value = toLocalInputValue(Date.now());
  renderFormHints();
  renderAll();
}
document.querySelectorAll('#tzDisplayPills button').forEach(b=> b.addEventListener('click', ()=>{
  // El campo de hora se reinterpreta en la nueva zona: se conserva el instante elegido.
  const input = document.getElementById('entryTimeInput');
  const ts = input.value ? fromInputValue(input.value) : NaN;
  setTimePref('display', b.dataset.v);
  if(!isNaN(ts)) input.value = toLocalInputValue(ts);
  renderFormHints();
}));
document.querySelectorAll('#dayEndPills button').forEach(b=> b.addEventListener('click', ()=> setTimePref('dayEnd', Number(b.dataset.v))));

// ---- Aviso de guardado ----
let savedTimer = null;
function flashSaved(){
  const pill = document.getElementById('savedPill');
  pill.innerHTML = Icons.svg('check', 14) + ' Guardado';
  pill.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(()=> pill.classList.remove('show'), 1600);
}

// Cualquier guardado mientras se está en Ajustes muestra el aviso.
const saveStateBase = saveState;
saveState = function(){
  const ok = saveStateBase.apply(this, arguments);
  if(document.querySelector('.tabpage[data-tab="settings"].active')) flashSaved();
  return ok;
};

function renderSettingsData(){ renderGoalPreview(); renderRiskQuick(); }
renderSettingsData.tab = 'settings';
onDataChange.push(renderSettingsData);
renderProfile();
renderGoalPreview();
renderRiskQuick();
renderTimePrefs();
