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
  const titles = real.map((v, i)=>{
    if(i === 0) return '<b>Inicio</b>';
    const h = trades[i - 1];
    const r = Analytics.pct(h);
    return `<div class="tip-h">Trade ${i} · ${fmtDate(h.ts)}${h.asset ? ' · ' + escapeHtml(h.asset) : ''}</div>
      <div class="tip-r"><span>Resultado</span><b class="${r > 0 ? 'pos' : r < 0 ? 'neg' : ''}">${fmtSignedPct(r)}</b></div>
      <div class="tip-r"><span>Acumulado</span><b>${fmtSignedPct(v)}</b></div>
      <div class="tip-r"><span>Con tu plan</span><b>${fmtSignedPct(plan[i])}</b></div>
      ${h.followedPlan ? '' : '<div class="tip-bad">Plan roto</div>'}`;
  });
  Charts.line(el, {
    height,
    area: true,
    band: true,
    series: [
      {values: real, color: 'var(--brand)', titles},
      {values: plan, color: 'var(--text-3)', dashed: true, width: 1.75},
    ],
    points: trades.map((h, i)=> h.followedPlan ? null : {i: i + 1, color: 'var(--danger)'}).filter(Boolean),
    format: v=> (v > 0 ? '+' : '') + v.toFixed(1) + '%',
  });
}

function renderHome(){
  const user = JournalAuth.currentUser();
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const first = user ? user.name.split(' ')[0] : '';
  const dateTxt = now.toLocaleDateString('es-AR', {weekday: 'long', day: 'numeric', month: 'long'});
  document.getElementById('helloDate').textContent = dateTxt.charAt(0).toUpperCase() + dateTxt.slice(1);
  document.getElementById('helloTitle').textContent = `${greet}${first ? ', ' + first : ''}`;

  const todayKey = dayKeyFromTs(Date.now());
  const today = state.history.filter(h=> dayKeyFromTs(h.ts) === todayKey);
  const todayPnl = today.reduce((a, h)=> a + Analytics.pct(h), 0);
  const streak = currentStreak();
  document.getElementById('helloSub').textContent = !state.history.length
    ? 'Registrá tu primer trade para empezar a medir tu disciplina.'
    : streak > 0
      ? `Llevás ${streak} ${streak === 1 ? 'trade seguido' : 'trades seguidos'} respetando tu plan. Seguí así.`
      : 'Tu último trade rompió el plan. El próximo es una nueva oportunidad de empezar la racha.';

  // KPIs
  const maxRisk = getMaxDailyRisk();
  const usedRisk = dayRiskMap()[todayKey] || 0;
  const month = monthPlanPct(monthKeyOf(Date.now()));
  const kpi = (label, value, sub, cls = '')=> `<div class="kpi ${cls}"><div class="kpi-l">${label}</div><div class="kpi-v">${value}</div><div class="kpi-s">${sub}</div></div>`;
  document.getElementById('homeKpis').innerHTML = [
    kpi('Racha actual', streak, `Mejor racha: ${state.bestStreak}`, streak > 0 ? 'good' : ''),
    kpi('Hoy', today.length ? fmtSignedPct(todayPnl) : '—', `${today.length} ${today.length === 1 ? 'trade' : 'trades'}`, today.length ? (todayPnl > 0 ? 'good' : todayPnl < 0 ? 'bad' : '') : ''),
    kpi('Riesgo disponible hoy', maxRisk === null ? '—' : Math.max(0, maxRisk - usedRisk).toFixed(1) + '%', maxRisk === null ? 'Definilo en Ajustes' : `Máximo ${maxRisk}% por día`, maxRisk !== null && usedRisk > maxRisk ? 'bad' : ''),
    kpi('Plan seguido este mes', month.n ? Math.round(month.pct) + '%' : '—', `Meta: ${goalPct()}%`, month.n ? (month.pct >= goalPct() ? 'good' : 'warn') : ''),
  ].join('');

  // Curva
  equityChart(document.getElementById('homeChart'), 190);

  // Patrones
  renderInsightList(document.getElementById('homeInsights'), Analytics.insights().slice(0, 3),
    state.history.length < 3 ? 'Con 3 trades o más vas a empezar a ver patrones de tu operativa acá.' : 'Todavía no hay patrones claros. Seguí registrando emociones y errores en cada trade.');

  // Último trade
  const last = state.history[0];
  const lastBox = document.getElementById('homeLast');
  if(!last){
    lastBox.innerHTML = '<div class="empty">Todavía no registraste trades.</div>';
  } else {
    const emo = emotionById(last.emotion);
    const r = realR(last);
    lastBox.innerHTML = `
      <div class="last-top">
        <div>
          <div class="last-asset">${escapeHtml(last.asset || 'Trade')}${last.direction ? ` <span class="last-dir">${last.direction === 'long' ? 'Long ↑' : 'Short ↓'}</span>` : ''}</div>
          <div class="last-date">${fmtDate(last.ts)} · ${sessionOf(last.ts)}</div>
        </div>
        <div class="last-res ${Analytics.pct(last) > 0 ? 'pos' : Analytics.pct(last) < 0 ? 'neg' : ''}">${last.resultPct === null || last.resultPct === undefined ? '—' : fmtSignedPct(last.resultPct)}</div>
      </div>
      <div class="tags">
        <span class="tag ${last.followedPlan ? 'good' : 'bad'}">${last.followedPlan ? 'Plan seguido' : 'Plan roto'}</span>
        ${emo ? `<span class="tag">${emo.label}</span>` : ''}
        ${r !== null ? `<span class="tag">${r > 0 ? '+' : ''}${r.toFixed(1)}R</span>` : ''}
        ${(last.errors || []).map(id=> errorById(id)).filter(Boolean).map(e=> `<span class="tag bad">${e.label}</span>`).join('')}
      </div>
      ${last.note ? `<p class="last-note">${escapeHtml(last.note)}</p>` : ''}`;
  }

  // Meta del mes
  const goal = goalPct();
  const ratio = Math.min(month.pct / goal, 1);
  document.getElementById('homeGoal').innerHTML = `
    <div class="goal-row">
      <div><span class="goal-big">${month.n ? Math.round(month.pct) : 0}%</span> <span class="goal-of">de ${goal}% de trades con el plan seguido</span></div>
      <div class="goal-state">${!month.n ? 'Sin trades este mes' : month.pct >= goal ? '✓ Meta cumplida' : `Te faltan ${Math.ceil(goal - month.pct)} puntos`}</div>
    </div>
    <div class="goal-bar"><div class="goal-fill" style="width:${Math.round(ratio * 100)}%"></div><div class="goal-mark" style="left:100%"></div></div>
    <div class="goal-sub">${month.n} ${month.n === 1 ? 'trade' : 'trades'} en ${new Date().toLocaleDateString('es-AR', {month: 'long'})}</div>`;

  // Logros
  const unlocked = ACHIEVEMENTS.filter(a=> state.achievements[a.id]).length;
  document.getElementById('badgeCount').textContent = `${unlocked} de ${ACHIEVEMENTS.length}`;
  document.getElementById('homeBadges').innerHTML = ACHIEVEMENTS.map(a=>{
    const at = state.achievements[a.id];
    return `<div class="badge-card ${at ? 'on' : ''}" title="${a.desc}">
      <div class="badge-ic">${Icons.svg(at ? a.icon : 'lock', 20)}</div>
      <div class="badge-t">${a.title}</div>
      <div class="badge-d">${at ? 'Desbloqueado el ' + fmtDate(at) : a.desc}</div>
    </div>`;
  }).join('');
}

onDataChange.push(renderHome);
Charts.register(()=> equityChart(document.getElementById('homeChart'), 190));
renderHome();
