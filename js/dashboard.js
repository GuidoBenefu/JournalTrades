// Pestaña Inicio: resumen del día, curva, patrones, último trade, meta y logros.

function renderInsightList(el, list, emptyText){
  if(!list.length){
    el.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }
  el.innerHTML = list.map(i=> `<div class="insight ${i.tone}"><span class="insight-ic">${Icons.svg(i.icon, 17)}</span><p>${i.text}</p></div>`).join('');
}

function equityChart(el, height, list){
  const {trades, real, plan} = Analytics.equityCurves(list);
  // El detalle de cada punto se arma recién cuando se pasa el mouse.
  const titles = i=>{
    const v = real[i];
    if(i === 0) return '<b>Inicio</b>';
    const h = trades[i - 1];
    const r = Analytics.pct(h);
    return `<div class="tip-h">Trade ${i} · ${fmtDate(h.ts)}${h.asset ? ' · ' + escapeHtml(h.asset) : ''}</div>
      <div class="tip-r"><span>Resultado</span><b class="${r > 0 ? 'pos' : r < 0 ? 'neg' : ''}">${fmtSignedPct(r)}</b></div>
      <div class="tip-r"><span>Acumulado</span><b>${fmtSignedPct(v)}</b></div>
      <div class="tip-r"><span>Con tu plan</span><b>${fmtSignedPct(plan[i])}</b></div>
      ${h.followedPlan ? '' : '<div class="tip-bad">Plan roto</div>'}`;
  };
  Charts.line(el, {
    height,
    area: true,
    band: true,
    series: [
      {values: real, color: 'var(--brand)', titles},
      {values: plan, color: 'var(--text-3)', dashed: true, width: 1.75},
    ],
    points: trades.map((h, i)=> h.followedPlan ? null : {i: i + 1, color: 'var(--danger)'}).filter(Boolean),
    format: fmtSignedPct,
  });
}

let showAllBadges = false;


// Progreso hacia cada logro (0 a 1) para mostrar el próximo.
function achievementProgress(a){
  const n = state.history.length, best = state.bestStreak, reviews = Object.keys(state.reviews || {}).length;
  const map = {
    first_trade: [n, 1], trades_10: [n, 10], trades_50: [n, 50], trades_100: [n, 100],
    streak_5: [best, 5], streak_10: [best, 10], streak_25: [best, 25], streak_50: [best, 50],
    first_review: [reviews, 1], reviews_4: [reviews, 4],
  };
  if(a.id === 'clean_10'){
    let run = 0, b = 0;
    Analytics.chronological().forEach(h=>{ run = (h.errors && h.errors.length) ? 0 : run + 1; b = Math.max(b, run); });
    map.clean_10 = [b, 10];
  }
  if(a.id === 'goal_month'){
    // Primero hacen falta 10 trades en el mes; después, llegar a la meta.
    const m = monthPlanPct(monthKeyOf(Date.now()));
    const target = goalTarget();
    if(m.n < 10) return {cur: m.n, max: 10, ratio: m.n / 10 * 0.5, label: `Vas ${m.n}/10 trades este mes`};
    return {cur: Math.round(m.pct), max: target, ratio: Math.min(m.pct / target, 1), label: `Vas ${Math.round(m.pct)}% de ${target}% de plan este mes`};
  }
  const v = map[a.id];
  return v ? {cur: Math.min(v[0], v[1]), max: v[1], ratio: Math.min(v[0] / v[1], 1), label: `Vas ${Math.min(v[0], v[1])}/${v[1]}`} : null;
}

function renderHero(user, streak){
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const first = user ? user.name.split(' ')[0] : '';
  const dateTxt = now.toLocaleDateString(LOCALE, {weekday: 'long', day: 'numeric', month: 'long'});
  document.getElementById('helloDate').textContent = dateTxt.charAt(0).toUpperCase() + dateTxt.slice(1);
  document.getElementById('helloTitle').textContent = `${greet}${first ? ', ' + first : ''}`;
  if(user) paintAvatar(document.getElementById('heroAvatar'), user);
  const sub = document.getElementById('helloSub');
  if(!state.history.length) sub.innerHTML = 'Bienvenido a tu journal. Empezá por los tres pasos de abajo.';
  else sub.textContent = 'Operá con un plan. Ejecutá con disciplina.';
}

// Regla del día: el compromiso de la revisión semanal o una regla del plan que rota.
function renderRule(){
  const box = document.getElementById('homeRule');
  const prev = state.reviews[Analytics.weekKey(Date.now() - 7 * 86400000)];
  const thisWeek = state.reviews[Analytics.weekKey(Date.now())];
  let kicker, text, icon;
  if(prev && prev.change && !thisWeek){ kicker = 'Tu compromiso de esta semana'; text = prev.change; icon = 'target'; }
  else if(state.items.length){
    const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
    const it = state.items[day % state.items.length];
    kicker = 'Regla del día · leela antes de operar'; icon = 'shield-check';
    text = escapeHtml(it.label) + (it.hint ? ` <span>· ${escapeHtml(it.hint)}</span>` : '');
  } else { box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = `<span class="dr-ic">${Icons.svg(icon, 20)}</span><div><div class="dr-k">${kicker}</div><div class="dr-t">${icon === 'target' ? escapeHtml(text) : text}</div></div>`;
}

function renderStarter(){
  const box = document.getElementById('homeStarter');
  const steps = [
    {done: state.items.length >= 2, t: 'Armá tu Trading Plan', s: 'Las reglas que tiene que cumplir cada trade.', go: 'settings', btn: 'Ir a Ajustes'},
    {done: state.history.length > 0, t: 'Registrá tu primer trade', s: 'Resultado, plan, emoción y lo que pasó.', go: 'register', btn: 'Registrar trade'},
    {done: Object.keys(state.reviews).length > 0, t: 'Hacé tu primera revisión', s: 'Cinco minutos al final de la semana.', go: 'review', btn: 'Ir a Revisión'},
  ];
  const done = steps.filter(s=> s.done).length;
  const show = done < 3 && state.history.length < 3;
  box.style.display = show ? '' : 'none';
  document.querySelectorAll('.home-data').forEach(el=> el.style.display = state.history.length ? '' : 'none');
  if(!show) return;
  const next = steps.findIndex(s=> !s.done);
  box.innerHTML = `<div class="card-head"><h2>Primeros pasos</h2><span class="card-meta">${done} de 3</span></div>
    <div class="starter-bar"><div style="width:${done / 3 * 100}%"></div></div>
    <div class="starter-steps">${steps.map((s, i)=> `<div class="st-step ${s.done ? 'done' : i === next ? 'next' : ''}">
      <span class="st-n">${s.done ? Icons.svg('check', 16) : i + 1}</span>
      <div class="st-txt"><b>${s.t}</b><span>${s.s}</span></div>
      ${!s.done && i === next ? `<button type="button" class="primary small" data-goto="${s.go}">${s.btn}</button>` : ''}
    </div>`).join('')}</div>`;
}

// Los números de Inicio miran todos la semana actual (lunes a domingo);
// el mes queda para el anillo de la meta.
function renderHomeKpis(streak){
  const week = Analytics.chronological(Analytics.tradesOfWeek(Analytics.weekKey(Date.now())));
  const ws = Analytics.summary(week);
  let acc = 0; const weekS = [0].concat(week.map(h=> acc += Analytics.pct(h)));
  let p = 0; const planS = week.map((h, i)=> (p += h.followedPlan ? 1 : 0) / (i + 1) * 100);
  let w = 0; const winS = week.map((h, i)=> (w += h.result === 'win' ? 1 : 0) / (i + 1) * 100);
  const streakS = Analytics.chronological().slice(-20).reduce((arr, h)=>{ arr.push(h.followedPlan ? (arr[arr.length - 1] || 0) + 1 : 0); return arr; }, []);
  const goal = goalPct();
  const card = (icon, tone, label, value, valCls, spark, sub)=> `<div class="sk sk-${tone}">
    <div class="sk-top"><span class="sk-ic">${Icons.svg(icon, 16)}</span><span class="sk-l">${label}</span></div>
    <div class="sk-v ${valCls}">${value}</div>${spark}<div class="sk-d">${sub}</div></div>`;
  const tradesTxt = `${ws.n} ${ws.n === 1 ? 'trade' : 'trades'} esta semana`;
  document.getElementById('homeKpis').innerHTML = [
    card('flame', streak > 0 ? 'good' : 'info', 'Racha actual', streak, streak > 0 ? 'pos' : '', Charts.spark(streakS, 'pos'), `Mejor racha: ${state.bestStreak}`),
    card('trending-up', ws.sum >= 0 ? 'good' : 'bad', 'Resultado semana', ws.n ? fmtSignedPct(ws.sum) : '—', signClass(ws.sum), Charts.spark(weekS, ws.sum >= 0 ? 'pos' : 'neg'), tradesTxt),
    card('shield-check', !ws.n ? 'info' : ws.planPct >= goal ? 'good' : 'warn', 'Plan semana', ws.n ? Math.round(ws.planPct) + '%' : '—', !ws.n ? '' : ws.planPct >= goal ? 'pos' : 'warn', Charts.spark(planS, ws.planPct >= goal ? 'pos' : 'warn'), `Meta: ${goal}%`),
    card('target', 'info', 'Win rate semana', ws.n ? Math.round(ws.winRate) + '%' : '—', '', Charts.spark(winS, 'info'), tradesTxt),
  ].join('');
}

function renderToday(){
  const todayKey = dayKeyFromTs(Date.now());
  const today = viewTrades().filter(h=> dayKeyFromTs(h.ts) === todayKey);
  const s = Analytics.summary(today);
  const broken = today.filter(h=> !h.followedPlan).length;
  const maxRisk = getMaxDailyRisk();
  const used = todayRiskUsed();
  const d = keyDate(todayKey).toLocaleDateString(LOCALE, {weekday: 'long', day: 'numeric', month: 'long'});
  document.getElementById('todayDate').textContent = d.charAt(0).toUpperCase() + d.slice(1);
  let alert;
  if(maxRisk !== null && used >= maxRisk) alert = ['bad', 'alert-triangle', used > maxRisk ? `Superaste tu riesgo máximo (${fix1(used)}% de ${maxRisk}%). Hoy no operes más.` : 'Llegaste a tu límite de riesgo. Hoy no operes más.'];
  else if(broken >= 2) alert = ['bad', 'alert-triangle', `Hoy rompiste el plan ${broken} veces. ¿Te tomás una pausa?`];
  else if(broken === 1) alert = ['warn', 'alert-triangle', 'Rompiste el plan una vez hoy. Bajá el ritmo y revisá tus reglas antes del próximo.'];
  else if(!today.length) alert = ['info', 'shield-check', 'Todavía no operaste hoy. Leé tu regla del día antes de entrar.'];
  else alert = ['good', 'check', 'Vas bien: todo dentro del plan hoy.'];
  const ratio = maxRisk ? Math.min(used / maxRisk, 1) : 0;
  const rTone = !maxRisk ? '' : used >= maxRisk ? 'bad' : ratio >= 0.5 ? 'warn' : 'good';
  document.getElementById('homeToday').innerHTML = `
    <div class="today-stats">
      <div><span>Trades</span><b>${s.n}</b></div>
      <div><span>Resultado</span><b class="${signClass(s.sum)}">${s.n ? fmtSignedPct(s.sum) : '—'}</b></div>
      <div><span>En plan</span><b class="${!s.n ? '' : broken ? 'neg' : 'pos'}">${s.n ? `${s.n - broken}/${s.n}` : '—'}</b></div>
    </div>
    <div class="today-risk ${rTone}">
      <div class="tr-top"><span>Riesgo usado hoy</span><b>${maxRisk === null ? 'Definí tu máximo en Ajustes' : `${fix1(used)}% / ${maxRisk}%`}</b></div>
      <div class="tr-bar"><div style="width:${ratio * 100}%"></div></div>
      ${maxRisk !== null ? `<div class="tr-sub">${used >= maxRisk ? 'Sin riesgo disponible' : `Te quedan <b>${fix1(maxRisk - used)}%</b> de riesgo`}</div>` : ''}
    </div>
    <div class="today-alert ${alert[0]}">${Icons.svg(alert[1], 16)}<span>${alert[2]}</span></div>`;
}

function renderGoalRing(){
  const goal = goalPct();
  const m = monthPlanPct(monthKeyOf(Date.now()));
  const pct = m.n ? m.pct : 0;
  const tone = !m.n ? '' : pct >= goal ? 'good' : pct >= goal - 15 ? 'warn' : 'bad';
  const R = 62, C = 2 * Math.PI * R;
  const ga = (goal / 100) * 2 * Math.PI - Math.PI / 2;
  const [ny, nm, nd] = currentDayKey().split('-').map(Number);
  const daysLeft = new Date(ny, nm, 0).getDate() - nd;
  const inPlan = Math.round(pct / 100 * m.n);
  const g = goal / 100;
  const need = m.n && pct < goal && g < 1 ? Math.ceil((g * m.n - inPlan) / (1 - g) - 1e-9) : 0;
  document.getElementById('homeGoal').innerHTML = `<div class="goal-ring-wrap">
    <div class="ring ring-sm ${tone}">
      <svg viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="${R}" class="ring-bg"/>
        <circle cx="80" cy="80" r="${R}" class="ring-fg" stroke-dasharray="${C * pct / 100} ${C}" transform="rotate(-90 80 80)"/>
        <circle cx="${80 + Math.cos(ga) * R}" cy="${80 + Math.sin(ga) * R}" r="5" class="ring-goal"/>
      </svg>
      <div class="ring-c"><b>${m.n ? Math.round(pct) + '%' : '—'}</b><span>de ${goal}%</span></div>
    </div>
    <div class="goal-info">
      <div class="gi-state ${tone}">${!m.n ? 'Sin trades este mes' : pct >= goal ? `${Icons.svg('check', 15)} Meta cumplida` : `Te faltan ${Math.ceil(goal - pct)} puntos`}</div>
      <div class="gi-row"><span>Trades en plan</span><b>${inPlan}/${m.n}</b></div>
      ${need ? `<div class="gi-row"><span>Para llegar</span><b>${need} seguidos en plan</b></div>` : ''}
      <div class="gi-row"><span>Quedan</span><b>${daysLeft} ${daysLeft === 1 ? 'día' : 'días'} del mes</b></div>
    </div>
  </div>`;
}

function renderWeekStrip(){
  const start = Analytics.weekKey(Date.now());
  const todayKey = dayKeyFromTs(Date.now());
  const box = document.getElementById('homeWeek');
  box.innerHTML = WEEKDAYS.map((n, i)=>{
    const key = addDaysKey(start, i);
    const list = viewTrades().filter(h=> dayKeyFromTs(h.ts) === key);
    const sum = list.reduce((a, h)=> a + Analytics.pct(h), 0);
    const broke = list.some(h=> !h.followedPlan);
    const cls = !list.length ? 'none' : sum > 0 ? 'pos' : sum < 0 ? 'neg' : 'be';
    return `<button type="button" class="wd ${cls} ${key === todayKey ? 'today' : ''} ${key > todayKey ? 'future' : ''}" data-day="${key}" ${key > todayKey ? 'disabled' : ''}>
      <span class="wd-n">${n}</span><span class="wd-d">${Number(key.slice(8))}</span>
      <span class="wd-v">${list.length ? fmtSignedPct(sum) : '—'}</span>
      <span class="wd-c">${list.length ? `${list.length} ${list.length === 1 ? 'trade' : 'trades'}` : ''}</span>
      ${broke ? '<i class="wd-dot" title="Rompiste el plan"></i>' : ''}
    </button>`;
  }).join('');
  box.querySelectorAll('.wd').forEach(b=> b.addEventListener('click', ()=>{
    if(typeof openDay === 'function') openDay(b.dataset.day);
    else showTab('calendar');
  }));
}

function renderLastTrades(){
  const box = document.getElementById('homeLast');
  const list = viewTrades().slice(0, 5);
  if(!list.length){ box.innerHTML = '<div class="empty">Todavía no registraste trades.</div>'; return; }
  const [first, ...rest] = list;
  box.innerHTML = `<div class="hist">${typeof tradeRow === 'function' ? tradeRow(first, true) : ''}</div>
    <div class="mini-trades">${rest.map(h=>{
      const v = Analytics.pct(h);
      return `<button type="button" class="mt" data-id="${h.id}">
        <i class="mt-dot ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}"></i>
        <b>${h.asset ? escapeHtml(h.asset) : 'Trade'}</b>
        <span class="mt-meta">${fmtDate(h.ts)}${h.followedPlan ? '' : ' · <span class="neg">plan roto</span>'}</span>
        <span class="mt-v ${signClass(v)}">${fmtSignedPct(v)}</span>
      </button>`;
    }).join('')}</div>`;
  box.querySelectorAll('[data-id]').forEach(b=> b.addEventListener('click', ()=>{
    if(typeof openTrade === 'function') openTrade(b.dataset.id);
  }));
}

function renderBadges(){
  const unlocked = ACHIEVEMENTS.filter(a=> state.achievements[a.id]).sort((a, b)=> state.achievements[b.id] - state.achievements[a.id]);
  document.getElementById('badgeCount').innerHTML = `${unlocked.length} de ${ACHIEVEMENTS.length}`;
  const locked = ACHIEVEMENTS.filter(a=> !state.achievements[a.id]);
  const next = locked.map(a=> ({a, p: achievementProgress(a)})).filter(x=> x.p).sort((x, y)=> y.p.ratio - x.p.ratio)[0];
  const box = document.getElementById('homeBadges');
  const badge = a=>{
    const at = state.achievements[a.id];
    return `<div class="badge-card ${at ? 'on' : ''}" title="${a.desc}">
      <div class="badge-ic">${Icons.svg(at ? a.icon : 'lock', 20)}</div>
      <div class="badge-t">${a.title}</div>
      <div class="badge-d">${at ? 'Desbloqueado el ' + fmtDate(at) : a.desc}</div>
    </div>`;
  };
  box.innerHTML = `<div class="badges-row">
      <div class="badges-recent">${unlocked.length ? unlocked.slice(0, 3).map(badge).join('') : '<div class="empty">Todavía no desbloqueaste logros. El primero llega con tu primer trade.</div>'}</div>
      ${next ? `<div class="badge-next">
        <div class="bn-k">Próximo logro</div>
        <div class="bn-top"><span class="bn-ic">${Icons.svg(next.a.icon, 20)}</span><div><b>${next.a.title}</b><span>${next.a.desc}</span></div></div>
        <div class="bn-bar"><div style="width:${next.p.ratio * 100}%"></div></div>
        <div class="bn-p">${next.p.label}</div>
      </div>` : ''}
    </div>
    <button type="button" class="link-btn badges-toggle" id="badgesToggle">${showAllBadges ? 'Ocultar' : 'Ver todos los logros'} ${Icons.svg(showAllBadges ? 'chevron-up' : 'chevron-down', 14)}</button>
    ${showAllBadges ? `<div class="badges">${ACHIEVEMENTS.map(badge).join('')}</div>` : ''}`;
  document.getElementById('badgesToggle').addEventListener('click', ()=>{ showAllBadges = !showAllBadges; renderBadges(); });
}

function renderHome(){
  const user = JournalAuth.currentUser();
  const streak = currentStreak();
  renderHero(user, streak);
  renderRule();
  renderStarter();
  if(!state.history.length) { renderBadges(); return; }
  renderHomeKpis(streak);
  renderToday();
  renderGoalRing();
  renderWeekStrip();
  renderPropAccounts();
  renderLastTrades();
  renderInsightList(document.getElementById('homeInsights'), Analytics.insights().slice(0, 3),
    viewTrades().length < 3 ? 'Con 3 trades o más vas a empezar a ver patrones de tu operativa acá.' : 'Todavía no hay patrones claros. Seguí registrando emociones y errores en cada trade.');
  renderBadges();
}

renderHome.tab = 'home';
onDataChange.push(renderHome);
// Se dibuja cuando terminan de cargar todos los módulos (usa el Historial y el Calendario).
document.addEventListener('DOMContentLoaded', ()=> renderOrDefer(renderHome));
