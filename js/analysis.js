// Pestaña Estadísticas: filtro de período, números con tendencia, disciplina,
// curva, patrones, mapa de calor, desglose, comparación y cierre mensual.

const WEEKDAYS_ONE = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const PERIOD_LABELS = {week: 'Esta semana', month: 'Este mes', 90: 'Últimos 3 meses', all: 'Todo tu historial'};
const PREV_LABELS = {week: 'semana pasada', month: 'mes pasado', 90: '3 meses anteriores'};
let breakdownBy = 'emotion';
let breakdownSort = {key: 'n', dir: -1};
let statsPeriod = 'all';
try{ statsPeriod = localStorage.getItem('jt_stats_period') || 'all'; }catch(e){}
if(!PERIOD_LABELS[statsPeriod]) statsPeriod = 'all';

const avgOf = arr=> arr.length ? arr.reduce((a, b)=> a + b, 0) / arr.length : null;

// Trades del período elegido y del período anterior (para comparar).
// "Esta semana" y "Este mes" son calendario (igual que en Inicio, Historial y
// Revisión); "3 meses" son los últimos 90 días.
function periodLists(){
  if(statsPeriod === 'all') return {cur: viewTrades(), prev: null};
  let from, prevFrom;
  if(statsPeriod === 'week'){
    from = Analytics.weekStart(Date.now()).getTime();
    prevFrom = Analytics.weekStart(from - 3 * 86400000).getTime();
  } else if(statsPeriod === 'month'){
    from = dayStartTs(monthKeyOf(Date.now()) + '-01');
    prevFrom = dayStartTs(monthKeyOf(from - 86400000) + '-01');
  } else {
    from = Date.now() - 90 * 86400000;
    prevFrom = from - 90 * 86400000;
  }
  return {
    cur: viewTrades().filter(h=> h.ts >= from),
    prev: viewTrades().filter(h=> h.ts >= prevFrom && h.ts < from),
  };
}

function periodSummary(list){
  const s = Analytics.summary(list);
  const risks = list.map(h=> h.riskPct).filter(v=> v !== null && v !== undefined);
  const durs = list.map(h=> h.durationMin).filter(v=> v !== null && v !== undefined);
  const rs = list.map(realR).filter(v=> v !== null);
  return {...s, avgRisk: avgOf(risks), avgDur: avgOf(durs), avgR: avgOf(rs)};
}

// ---- 1. Filtro ----
function renderPeriodBar(cur){
  document.querySelectorAll('#statsPeriod button').forEach(b=> b.classList.toggle('active', b.dataset.p === statsPeriod));
  document.getElementById('statsRange').textContent = `${PERIOD_LABELS[statsPeriod]} · ${cur.length} ${cur.length === 1 ? 'trade' : 'trades'}`;
}

document.querySelectorAll('#statsPeriod button').forEach(b=> b.addEventListener('click', ()=>{
  statsPeriod = b.dataset.p;
  try{ localStorage.setItem('jt_stats_period', statsPeriod); }catch(e){}
  renderAnalysis();
}));

// ---- 2. Números ----
function renderKpis(cur, prev){
  const s = periodSummary(cur);
  const p = prev && prev.length ? periodSummary(prev) : null;
  const trades = Analytics.chronological(cur);
  let acc = 0, plan = 0, wins = 0;
  const accS = [0], planS = [], winS = [], countS = [0];
  trades.forEach((h, i)=>{
    acc += Analytics.pct(h); accS.push(acc);
    if(h.followedPlan) plan++; planS.push(plan / (i + 1) * 100);
    if(h.result === 'win') wins++; winS.push(wins / (i + 1) * 100);
    countS.push(i + 1);
  });
  const delta = (d, unit, label)=>{
    if(!p || !s.n) return `<div class="sk-d">${statsPeriod === 'all' ? 'Todo el historial' : 'Sin período anterior'}</div>`;
    if(Math.abs(d) < 0.05) return `<div class="sk-d">= que ${label}</div>`;
    const txt = unit === 'pts' ? Math.round(Math.abs(d)) + ' pts' : unit === '%' ? fix1(Math.abs(d)) + '%' : Math.abs(Math.round(d));
    return `<div class="sk-d ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '↑' : '↓'} ${txt} vs ${label}</div>`;
  };
  const prevLbl = PREV_LABELS[statsPeriod] || 'período anterior';
  const goal = goalPct();
  const card = (icon, tone, label, value, valCls, spark, d)=> `<div class="sk sk-${tone}">
    <div class="sk-top"><span class="sk-ic">${Icons.svg(icon, 16)}</span><span class="sk-l">${label}</span></div>
    <div class="sk-v ${valCls}">${value}</div>
    ${spark}${d}</div>`;
  document.getElementById('statsKpis').innerHTML = [
    card('trending-up', s.sum >= 0 ? 'good' : 'bad', 'Resultado acumulado', s.n ? fmtSignedPct(s.sum) : '—', signClass(s.sum),
      Charts.spark(accS, s.sum >= 0 ? 'pos' : 'neg'), delta(p ? s.sum - p.sum : 0, '%', prevLbl)),
    card('shield-check', s.planPct >= goal ? 'good' : 'warn', 'Siguió el plan', s.n ? Math.round(s.planPct) + '%' : '—', s.n ? (s.planPct >= goal ? 'pos' : 'warn') : '',
      Charts.spark(planS, s.planPct >= goal ? 'pos' : 'warn'), delta(p ? s.planPct - p.planPct : 0, 'pts', prevLbl)),
    card('target', 'info', 'Win rate', s.n ? Math.round(s.winRate) + '%' : '—', '',
      Charts.spark(winS, 'info'), delta(p ? s.winRate - p.winRate : 0, 'pts', prevLbl)),
    card('chart-column', 'info', 'Trades', s.n, '',
      Charts.spark(countS, 'info'), delta(p ? s.n - p.n : 0, 'n', prevLbl)),
  ].join('');

  const mini = (label, value)=> `<div class="sk2"><span>${label}</span><b>${value}</b></div>`;
  document.getElementById('statsSecondary').innerHTML = [
    mini('Resultado prom./trade', s.n ? `<span class="${signClass(s.avg)}">${fmtSignedPct(s.avg)}</span>` : '—'),
    mini('Riesgo promedio', s.avgRisk === null ? '—' : fix1(s.avgRisk) + '%'),
    mini('Duración promedio', s.avgDur === null ? '—' : Math.round(s.avgDur) + ' min'),
    mini('R real promedio', s.avgR === null ? '—' : `<span class="${signClass(s.avgR)}">${(s.avgR > 0 ? '+' : '') + s.avgR.toFixed(1)}R</span>`),
  ].join('');
}

// ---- 3. Anillo de disciplina ----
function renderRing(cur){
  const s = Analytics.summary(cur);
  const goal = goalPct();
  const box = document.getElementById('disciplineRing');
  const pct = s.n ? s.planPct : 0;
  const tone = !s.n ? '' : pct >= goal ? 'good' : pct >= goal - 15 ? 'warn' : 'bad';
  const R = 70, C = 2 * Math.PI * R;
  const ga = (goal / 100) * 2 * Math.PI - Math.PI / 2;
  const gx = 90 + Math.cos(ga) * R, gy = 90 + Math.sin(ga) * R;
  const followed = cur.filter(h=> h.followedPlan).length;
  box.innerHTML = `<div class="ring ${tone}">
      <svg viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="${R}" class="ring-bg"/>
        <circle cx="90" cy="90" r="${R}" class="ring-fg" stroke-dasharray="${C * pct / 100} ${C}" transform="rotate(-90 90 90)"/>
        <circle cx="${gx}" cy="${gy}" r="5" class="ring-goal"/>
      </svg>
      <div class="ring-c"><b>${s.n ? Math.round(pct) + '%' : '—'}</b><span>plan respetado</span></div>
    </div>
    <div class="ring-msg ${tone}">${!s.n ? 'Registrá trades para medir tu disciplina.' : pct >= goal ? `${Icons.svg('check', 14)} Estás arriba de tu meta del ${goal}%` : `${Icons.svg('alert-triangle', 14)} Te faltan ${Math.ceil(goal - pct)} pts para tu meta del ${goal}%`}</div>
    <div class="ring-stats">
      <div><b>${followed}/${s.n}</b><span>trades en plan</span></div>
      <div><b>${currentStreak()}</b><span>racha actual</span></div>
      <div><b>${state.bestStreak}</b><span>mejor racha</span></div>
    </div>`;
}

// ---- 4. Curva ----
function drawCurve(){
  equityChart(document.getElementById('equityChart'), 280, periodLists().cur);
}
function renderCurveCard(cur){
  drawCurve();
  document.getElementById('curveMeta').textContent = cur.length ? `${cur.length} ${cur.length === 1 ? 'trade' : 'trades'}` : '';
}

// ---- 5. Patrones ----
function renderInsights(cur){
  const box = document.getElementById('allInsights');
  // El costo de romper el plan ya está en el destacado y en "Plan seguido vs. roto":
  // no se repite en la lista.
  const list = Analytics.insights(cur).filter(i=> i.id !== 'broken_cost' && i.id !== 'plan_vs_broken');
  const {real, plan} = Analytics.equityCurves(cur);
  const diff = plan[plan.length - 1] - real[real.length - 1];
  let hero = null;
  if(cur.length && diff > 0.05) hero = {tone: 'bad', icon: 'trending-down', big: `Romper el plan te costó ${diff.toFixed(1)} puntos`,
    text: `Resultado real ${fmtSignedPct(real[real.length - 1])} · con tu plan habrías hecho ${fmtSignedPct(plan[plan.length - 1])}.`};
  else if(cur.length >= 3 && diff <= 0.05 && cur.every(h=> h.followedPlan)) hero = {tone: 'good', icon: 'sparkles', big: 'Respetaste tu plan en todos los trades',
    text: `Resultado del período: ${fmtSignedPct(real[real.length - 1])}. Así se construye un sistema medible.`};
  if(!list.length && !hero){
    box.innerHTML = `<div class="empty">${cur.length < 3 ? 'Con 3 trades o más en el período vas a empezar a ver patrones.' : 'Todavía no hay patrones claros. Registrá emoción, errores, activo y horario en cada trade: cuantos más datos, más patrones aparecen.'}</div>`;
    return;
  }
  const good = list.filter(i=> i.tone === 'good'), bad = list.filter(i=> i.tone === 'bad'), info = list.filter(i=> i.tone === 'info');
  const card = i=> `<div class="insight ${i.tone}"><span class="insight-ic">${Icons.svg(i.icon, 17)}</span><p>${i.text}</p></div>`;
  const col = (cls, icon, title, items, empty)=> `<div class="ins-col ${cls}">
    <div class="ins-col-t">${Icons.svg(icon, 15)} ${title}</div>
    ${items.length ? items.map(card).join('') : `<div class="ins-empty">${empty}</div>`}</div>`;
  box.innerHTML = (hero ? `<div class="ins-hero ${hero.tone}"><span class="ins-hero-ic">${Icons.svg(hero.icon, 24)}</span><div><b>${hero.big}</b><p>${hero.text}</p></div></div>` : '')
    + `<div class="ins-cols">${col('good', 'smile', 'Lo que te funciona', good, 'Todavía no aparece un patrón positivo claro.')}${col('bad', 'alert-triangle', 'Lo que te cuesta plata', bad, 'No aparecen patrones que te estén costando.')}</div>`
    + (info.length ? `<div class="ins-col info ins-info">${`<div class="ins-col-t">${Icons.svg('lightbulb', 15)} Para tener en cuenta</div>`}${info.map(card).join('')}</div>` : '');
}

// ---- 6. Mapa de calor ----
function heatColor(t){
  return t <= 0.5
    ? `color-mix(in srgb, var(--amber) ${Math.round(t * 200)}%, var(--success))`
    : `color-mix(in srgb, var(--danger) ${Math.round((t - 0.5) * 200)}%, var(--amber))`;
}

function renderHeatmap(cur){
  const el = document.getElementById('heatmap');
  const {cells} = Analytics.heatmap(cur);
  const keys = Object.keys(cells);
  if(!keys.length){
    el.innerHTML = '<div class="empty">Registrá trades con su hora de entrada para ver el mapa.</div>';
    el.style.gridTemplateColumns = '';
    return;
  }
  const days = [...new Set(keys.map(k=> Number(k.split('-')[0])))].sort((a, b)=> a - b);
  const hours = [...new Set(keys.map(k=> Number(k.split('-')[1])))].sort((a, b)=> a - b);
  el.style.gridTemplateColumns = `44px repeat(${hours.length}, minmax(44px, 1fr))`;
  let html = '<div></div>' + hours.map(h=> `<div class="hm-h">${h}h</div>`).join('');
  days.forEach(di=>{
    html += `<div class="hm-d">${WEEKDAYS[di]}</div>`;
    hours.forEach(h=>{
      const c = cells[di + '-' + h];
      if(!c){ html += '<div class="hm-c"></div>'; return; }
      const t = c.broken / c.n;
      const col = heatColor(t);
      html += `<div class="hm-c on" style="--hc:${col}" data-k="${di}-${h}">${c.n}</div>`;
    });
  });
  el.innerHTML = html;
  el.querySelectorAll('.hm-c.on').forEach(cell=>{
    const [di, h] = cell.dataset.k.split('-').map(Number);
    const c = cells[cell.dataset.k];
    const planPct = Math.round((c.n - c.broken) / c.n * 100);
    const html = `<div class="tip-h">${WEEKDAYS_ONE[di].charAt(0).toUpperCase() + WEEKDAYS_ONE[di].slice(1)} · ${h}:00 a ${(h + 1) % 24}:00 NY</div>
      <div class="tip-r"><span>Trades</span><b>${c.n}</b></div>
      <div class="tip-r"><span>Plan seguido</span><b class="${planPct >= 80 ? 'pos' : planPct < 50 ? 'neg' : ''}">${planPct}%</b></div>
      <div class="tip-r"><span>Resultado</span><b class="${signClass(c.sum)}">${fmtSignedPct(c.sum)}</b></div>`;
    cell.addEventListener('mousemove', e=> ChartTip.show(html, e.clientX, e.clientY));
    cell.addEventListener('mouseleave', ()=> ChartTip.hide());
    cell.addEventListener('click', e=> ChartTip.show(html, e.clientX, e.clientY));
  });
}

// ---- 7. Desglose ----
const BREAKDOWNS = {
  emotion: {label: 'Emoción', key: h=> h.emotion, name: k=>{ const e = emotionById(k); return e ? e.label : k; }, empty: 'Marcá cómo te sentías al entrar en cada trade para ver este desglose.'},
  error: {label: 'Error', key: h=> h.errors || [], name: k=>{ const e = errorById(k); return e ? e.label : k; }, empty: 'Todavía no marcaste errores en tus trades.'},
  session: {label: 'Sesión', key: h=> sessionOf(h.ts), name: k=> k},
  asset: {label: 'Activo', key: h=> h.asset, name: k=> escapeHtml(k), empty: 'Cargá el activo en tus trades para ver este desglose.'},
  setup: {label: 'Setup', key: h=> h.setup, name: k=> escapeHtml(k), empty: 'Cargá el setup en tus trades para ver este desglose.'},
  direction: {label: 'Dirección', key: h=> h.direction, name: k=> k === 'long' ? 'Long' : 'Short', empty: 'Marcá si fue long o short para ver este desglose.'},
};
const BD_COLS = [['name', null], ['n', 'Trades'], ['planPct', 'Plan seguido'], ['winRate', 'Win rate'], ['avg', 'Prom./trade'], ['sum', 'Total']];

function renderBreakdown(cur){
  cur = cur || periodLists().cur;
  const cfg = BREAKDOWNS[breakdownBy];
  document.querySelectorAll('#breakdownPills .pill').forEach(b=> b.classList.toggle('active', b.dataset.by === breakdownBy));
  const rows = Analytics.group(cur, cfg.key);
  const table = document.getElementById('breakdownTable');
  if(!rows.length){
    table.innerHTML = `<tr><td class="empty">${cfg.empty || 'Todavía no hay datos.'}</td></tr>`;
    return;
  }
  const {key, dir} = breakdownSort;
  rows.sort((a, b)=> key === 'name' ? dir * String(cfg.name(a.key)).localeCompare(String(cfg.name(b.key))) : dir * (a[key] - b[key]));
  let best = null, worst = null;
  if(rows.length >= 2){
    const byAvg = rows.slice().sort((a, b)=> b.avg - a.avg);
    if(byAvg[0].avg > 0) best = byAvg[0].key;
    if(byAvg[byAvg.length - 1].avg < 0) worst = byAvg[byAvg.length - 1].key;
  }
  const maxAbs = Math.max(...rows.map(r=> Math.abs(r.sum)), 0.1);
  const th = ([k, label])=> `<th class="sortable ${key === k ? 'sorted' : ''}" data-k="${k}">${label || cfg.label}${key === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  table.innerHTML = `
    <thead><tr>${BD_COLS.map(th).join('')}</tr></thead>
    <tbody>${rows.map(r=> `<tr class="${r.key === best ? 'row-best' : r.key === worst ? 'row-worst' : ''}">
      <td><span class="bd-name">${cfg.name(r.key)}</span>${r.key === best ? '<span class="bd-tag good">Mejor</span>' : r.key === worst ? '<span class="bd-tag bad">Peor</span>' : ''}</td>
      <td>${r.n}</td>
      <td><div class="mini-bar ${r.planPct >= goalPct() ? '' : r.planPct >= 50 ? 'warn' : 'bad'}"><div style="width:${Math.round(r.planPct)}%"></div></div>${Math.round(r.planPct)}%</td>
      <td>${Math.round(r.winRate)}%</td>
      <td class="${signClass(r.avg)}">${fmtSignedPct(r.avg)}</td>
      <td><div class="div-bar"><div class="div-track"><div class="${r.sum >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(r.sum) / maxAbs * 50}%"></div></div><span class="${signClass(r.sum)}">${fmtSignedPct(r.sum)}</span></div></td>
    </tr>`).join('')}</tbody>`;
  table.querySelectorAll('th.sortable').forEach(t=> t.addEventListener('click', ()=>{
    const k = t.dataset.k;
    breakdownSort = {key: k, dir: breakdownSort.key === k ? -breakdownSort.dir : (k === 'name' ? 1 : -1)};
    renderBreakdown();
  }));
}

document.querySelectorAll('#breakdownPills .pill').forEach(b=> b.addEventListener('click', ()=>{
  breakdownBy = b.dataset.by;
  renderBreakdown();
}));

// ---- 8. Plan seguido vs. roto ----
function renderCompare(cur){
  const box = document.getElementById('compareBox');
  const f = periodSummary(cur.filter(h=> h.followedPlan));
  const b = periodSummary(cur.filter(h=> !h.followedPlan));
  if(!cur.length){ box.innerHTML = '<div class="empty">Todavía no hay trades en el período.</div>'; return; }
  const rows = [
    ['Trades', f.n, b.n, v=> v, (a, c)=> (a - c > 0 ? '+' : '') + (a - c)],
    ['Prom./trade', f.avg, b.avg, fmtSignedPct, (a, c)=> (a - c > 0 ? '+' : '') + (a - c).toFixed(1) + ' pts'],
    ['Win rate', f.winRate, b.winRate, v=> Math.round(v) + '%', (a, c)=> (a - c > 0 ? '+' : '') + Math.round(a - c) + ' pts'],
    ['Duración', f.avgDur, b.avgDur, v=> v === null ? '—' : Math.round(v) + ' min', (a, c)=> a === null || c === null ? '' : (a - c > 0 ? '+' : '') + Math.round(a - c) + ' min'],
    ['Acumulado', f.sum, b.sum, fmtSignedPct, (a, c)=> (a - c > 0 ? '+' : '') + (a - c).toFixed(1) + ' pts'],
  ];
  box.innerHTML = `<div class="vs-head"><span class="vs-good">${Icons.svg('shield-check', 15)} Plan seguido</span><span></span><span class="vs-bad">Plan roto ${Icons.svg('alert-triangle', 15)}</span></div>`
    + rows.map(([label, a, c, fmt, diff])=>{
      const na = f.n ? a : null, nc = b.n ? c : null;
      const m = Math.max(Math.abs(na || 0), Math.abs(nc || 0)) || 1;
      const w = v=> v === null ? 0 : Math.abs(v) / m * 100;
      const val = (v, n)=> n && v !== null ? fmt(v) : '—';
      const d = f.n && b.n && na !== null && nc !== null ? diff(na, nc) : '';
      return `<div class="vs-row">
        <div class="vs-side l"><span class="vs-v">${val(a, f.n)}</span><div class="vs-bar"><div class="${na < 0 ? 'neg' : 'pos'}" style="width:${w(na)}%"></div></div></div>
        <div class="vs-mid"><span>${label}</span>${d ? `<b>${d}</b>` : ''}</div>
        <div class="vs-side r"><div class="vs-bar"><div class="${nc < 0 ? 'neg' : 'pos-muted'}" style="width:${w(nc)}%"></div></div><span class="vs-v">${val(c, b.n)}</span></div>
      </div>`;
    }).join('');
}

function renderItemStats(cur){
  const box = document.getElementById('itemStats');
  if(!state.items.length){ box.innerHTML = '<div class="empty">Armá tu Trading Plan en Ajustes para ver qué reglas cumplís más.</div>'; return; }
  if(!cur.length){ box.innerHTML = '<div class="empty">Todavía no hay trades en el período.</div>'; return; }
  // Cada regla se mide solo en los trades registrados después de crearla.
  const rows = state.items.map(it=>{
    const since = ruleCreatedAt(it);
    const list = cur.filter(h=> h.ts >= since || h.loggedAt >= since);
    const miss = list.filter(h=> (h.missingIds || []).includes(it.id) || (!h.missingIds && (h.missing || []).includes(it.label))).length;
    const c = list.length - miss;
    return {label: it.label, c, n: list.length, pct: list.length ? Math.round(c / list.length * 100) : 0};
  }).filter(r=> r.n).sort((a, b)=> b.pct - a.pct);
  if(!rows.length){ box.innerHTML = '<div class="empty">Tus reglas actuales son más nuevas que los trades del período.</div>'; return; }
  box.innerHTML = rows.map(r=> `<div class="itemstat ${r.pct >= 80 ? 'good' : r.pct >= 50 ? 'warn' : 'bad'}">
    <div class="top"><span>${escapeHtml(r.label)}</span><span><b>${r.pct}%</b> · ${r.c}/${r.n}</span></div>
    <div class="bar"><div class="fill" style="width:${r.pct}%"></div></div></div>`).join('');
}

// ---- 9. Cierre mensual ----
function renderMonths(){
  const box = document.getElementById('closedMonths');
  const curKey = monthKeyOf(Date.now());
  const cur = viewTrades().filter(h=> monthKeyOf(h.ts) === curKey);
  const s = summarizePeriod(cur);
  const months = [{label: monthLabel(), count: s.total, sum: s.sum, followedPct: s.pct, followedPctRaw: s.pctRaw, avgPerDay: s.avgPerDay, riskMgmtPct: s.riskMgmtPct, current: true}]
    .concat(closedMonthsList());
  const goal = goalPct();
  box.innerHTML = months.map(m=>{
    const tone = !m.count ? '' : m.sum > 0 ? 'pos' : m.sum < 0 ? 'neg' : '';
    const met = m.followedPctRaw >= goal;
    return `<div class="month ${tone} ${m.current ? 'current' : ''}">
      <div class="month-top"><span class="month-l">${m.label}</span>${m.current ? '<span class="month-tag">En curso</span>' : `<span class="month-tag ${met ? 'good' : 'warn'}">${met ? 'Meta cumplida' : 'Meta no cumplida'}</span>`}</div>
      <div class="month-v ${tone}">${m.count ? fmtSignedPct(m.sum) : '—'}</div>
      <div class="month-plan"><span>Plan seguido</span><b>${m.count ? m.followedPct + '%' : '—'}</b></div>
      <div class="month-bar"><div class="${met ? 'good' : 'warn'}" style="width:${m.count ? m.followedPct : 0}%"></div><i style="left:${goal}%"></i></div>
      <div class="month-stats">
        <span><b>${m.count}</b> trades</span>
        <span><b>${m.avgPerDay === null || m.avgPerDay === undefined ? '—' : m.avgPerDay.toFixed(1)}</b> por día operado</span>
        <span><b>${m.riskMgmtPct === null || m.riskMgmtPct === undefined ? '—' : m.riskMgmtPct + '%'}</b> risk mgmt</span>
      </div>
    </div>`;
  }).join('');
}

function renderAnalysis(){
  const {cur, prev} = periodLists();
  renderPeriodBar(cur);
  renderKpis(cur, prev);
  renderRing(cur);
  renderCurveCard(cur);
  renderInsights(cur);
  renderHeatmap(cur);
  renderBreakdown(cur);
  renderCompare(cur);
  renderItemStats(cur);
  renderMonths();
}

renderAnalysis.tab = 'stats';
onDataChange.push(renderAnalysis);
Charts.register(drawCurve);
renderOrDefer(renderAnalysis);
