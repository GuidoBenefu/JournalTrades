// Pestaña Estadísticas: filtro de período, números con tendencia, disciplina,
// curva, patrones, mapa de calor, desglose, comparación y cierre mensual.

// Nombre de cada día (lunes = 0) en el idioma activo. El 1/1/2024 fue lunes.
const WEEKDAYS_ONE = [0, 1, 2, 3, 4, 5, 6].map(i=> new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE, {weekday: 'long'}));
const PERIOD_LABELS = {week: t('Esta semana'), month: t('Este mes'), 90: t('Últimos 3 meses'), all: t('Todo tu historial'), custom: t('Rango de fechas')};
const PREV_LABELS = {week: t('semana pasada'), month: t('mes pasado'), 90: t('3 meses anteriores'), custom: t('período anterior')};
let breakdownBy = 'emotion';
let breakdownSort = {key: 'n', dir: -1};
let statsPeriod = 'all';
try{ statsPeriod = localStorage.getItem('jt_stats_period') || 'all'; }catch(e){}
if(!PERIOD_LABELS[statsPeriod]) statsPeriod = 'all';
// Rango propio (días de trading AAAA-MM-DD, inclusive).
let statsRange = {from: '', to: ''};
try{ statsRange = {...statsRange, ...JSON.parse(localStorage.getItem('jt_stats_range') || '{}')}; }catch(e){}
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const rangeOk = ()=> KEY_RE.test(statsRange.from) && KEY_RE.test(statsRange.to) && statsRange.from <= statsRange.to;
if(statsPeriod === 'custom' && !rangeOk()) statsPeriod = 'all';

// ---- Filtros combinables ----
// Dentro de un filtro, cualquiera de los valores elegidos; entre filtros, todos.
const normSetup = s=> String(s || '').trim().toLowerCase();
const capFirst = s=> s.charAt(0).toUpperCase() + s.slice(1);
const STATS_FILTERS = [
  {k: 'setup', label: t('Setup'), key: h=> normSetup(h.setup) || null},
  {k: 'session', label: t('Sesión'), key: h=> sessionOf(h.ts)},
  {k: 'emotion', label: t('Emoción'), key: h=> h.emotion, name: v=>{ const e = emotionById(v); return e ? e.label : v; }},
  {k: 'error', label: t('Error'), key: h=> h.errors || [], name: v=>{ const e = errorById(v); return e ? e.label : v; }},
  {k: 'asset', label: t('Activo'), key: h=> h.asset},
  {k: 'direction', label: t('Dirección'), key: h=> h.direction, name: v=> v === 'long' ? t('Long') : t('Short')},
  {k: 'plan', label: t('Plan'), key: h=> h.followedPlan ? 'ok' : 'bad', name: v=> v === 'ok' ? t('Plan seguido') : t('Plan roto')},
  {k: 'result', label: t('Resultado'), key: h=> h.result, name: v=> RESULT_LABELS[v] || v},
  {k: 'weekday', label: t('Día'), key: h=> String(weekdayOf(h.ts)), name: v=> capFirst(WEEKDAYS_ONE[v]), order: (a, b)=> a - b},
];
let statsFilters = {};
try{ statsFilters = JSON.parse(localStorage.getItem('jt_stats_filters') || '{}') || {}; }catch(e){}
const activeFilters = ()=> STATS_FILTERS.filter(f=> (statsFilters[f.k] || []).length);
function matchesFilters(h){
  return activeFilters().every(f=>{
    const sel = statsFilters[f.k];
    return [].concat(f.key(h)).some(v=> v !== null && v !== undefined && sel.includes(String(v)));
  });
}
function saveFilters(){
  try{ localStorage.setItem('jt_stats_filters', JSON.stringify(statsFilters)); }catch(e){}
}
// Nombre visible de un valor (para el setup, el primero escrito tal cual).
function filterValueName(f, v){
  if(f.k === 'setup'){ const h = state.history.find(x=> normSetup(x.setup) === v); return escapeHtml(h ? h.setup.trim() : v); }
  return f.name ? f.name(v) : escapeHtml(v);
}
function toggleFilter(k, v, on){
  const sel = new Set(statsFilters[k] || []);
  if(on === undefined) on = !sel.has(v);
  on ? sel.add(v) : sel.delete(v);
  statsFilters[k] = [...sel];
  if(!statsFilters[k].length) delete statsFilters[k];
  saveFilters();
  renderAnalysis();
}

const avgOf = arr=> arr.length ? arr.reduce((a, b)=> a + b, 0) / arr.length : null;

// Trades del período elegido y del período anterior (para comparar).
// "Esta semana" y "Este mes" son calendario (igual que en Inicio, Historial y
// Revisión); "3 meses" son los últimos 90 días.
function periodLists(){
  const all = viewTrades().filter(matchesFilters);
  if(statsPeriod === 'all') return {cur: all, prev: null};
  if(statsPeriod === 'custom'){
    // El período anterior es un rango de la misma cantidad de días, justo antes.
    const days = Math.round((Date.parse(statsRange.to) - Date.parse(statsRange.from)) / 86400000) + 1;
    const prevTo = addDaysKey(statsRange.from, -1), prevFrom = addDaysKey(statsRange.from, -days);
    const inRange = (h, a, b)=>{ const k = dayKeyFromTs(h.ts); return k >= a && k <= b; };
    return {cur: all.filter(h=> inRange(h, statsRange.from, statsRange.to)), prev: all.filter(h=> inRange(h, prevFrom, prevTo))};
  }
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
    cur: all.filter(h=> h.ts >= from),
    prev: all.filter(h=> h.ts >= prevFrom && h.ts < from),
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
function rangeLabel(){
  const f = k=> keyDate(k).toLocaleDateString(LOCALE, {day: 'numeric', month: 'short', year: statsRange.from.slice(0, 4) !== statsRange.to.slice(0, 4) ? 'numeric' : undefined});
  return `${f(statsRange.from)} – ${f(statsRange.to)}`;
}
function renderPeriodBar(cur){
  document.querySelectorAll('#statsPeriod button').forEach(b=> b.classList.toggle('active', b.dataset.p === statsPeriod));
  const label = statsPeriod === 'custom' ? rangeLabel() : PERIOD_LABELS[statsPeriod];
  const nf = activeFilters().length;
  document.getElementById('statsRange').textContent = `${label} · ${tp(cur.length, '{n} trade', '{n} trades')}` + (nf ? ' · ' + tp(nf, '1 filtro', '{n} filtros') : '');
  const box = document.getElementById('statsRangeBox');
  box.style.display = statsPeriod === 'custom' || rangeOpen ? '' : 'none';
  const today = currentDayKey();
  ['statsFrom', 'statsTo'].forEach(id=> document.getElementById(id).max = today);
  if(document.activeElement.id !== 'statsFrom') document.getElementById('statsFrom').value = statsRange.from;
  if(document.activeElement.id !== 'statsTo') document.getElementById('statsTo').value = statsRange.to;
}

let rangeOpen = false;
document.querySelectorAll('#statsPeriod button').forEach(b=> b.addEventListener('click', ()=>{
  if(b.dataset.p === 'custom'){
    // Sin un rango válido, primero se eligen las fechas (arranca en los últimos 30 días).
    if(!rangeOk()){
      const today = currentDayKey();
      statsRange = {from: addDaysKey(today, -29), to: today};
      try{ localStorage.setItem('jt_stats_range', JSON.stringify(statsRange)); }catch(e){}
    }
    rangeOpen = true;
  } else rangeOpen = false;
  statsPeriod = b.dataset.p;
  try{ localStorage.setItem('jt_stats_period', statsPeriod); }catch(e){}
  renderAnalysis();
}));
['statsFrom', 'statsTo'].forEach(id=> document.getElementById(id).addEventListener('change', ()=>{
  const from = document.getElementById('statsFrom').value, to = document.getElementById('statsTo').value;
  const err = document.getElementById('statsRangeError');
  if(!KEY_RE.test(from) || !KEY_RE.test(to)){ err.textContent = t('Elegí las dos fechas.'); return; }
  if(from > to){ err.textContent = t('La fecha de inicio tiene que ser anterior a la de fin.'); return; }
  err.textContent = '';
  statsRange = {from, to};
  try{ localStorage.setItem('jt_stats_range', JSON.stringify(statsRange)); }catch(e){}
  renderAnalysis();
}));

// Barra de filtros: un menú por tipo con las opciones que aparecen en tus trades.
let openFilter = null;
function renderFilterBar(){
  const base = viewTrades();
  const bar = document.getElementById('statsFilters');
  const menus = STATS_FILTERS.map(f=>{
    const counts = new Map();
    base.forEach(h=> [].concat(f.key(h)).forEach(v=>{ if(v !== null && v !== undefined && v !== '') counts.set(String(v), (counts.get(String(v)) || 0) + 1); }));
    const sel = statsFilters[f.k] || [];
    sel.forEach(v=>{ if(!counts.has(v)) counts.set(v, 0); });
    if(!counts.size) return '';
    const opts = [...counts.entries()].sort(f.order ? (a, b)=> f.order(a[0], b[0]) : (a, b)=> b[1] - a[1]);
    return `<details class="flt ${sel.length ? 'on' : ''}" data-f="${f.k}" ${openFilter === f.k ? 'open' : ''}>
      <summary>${f.label}${sel.length ? ` <b>${sel.length}</b>` : ''} ${Icons.svg('chevron-down', 14)}</summary>
      <div class="flt-menu">${opts.map(([v, n])=> `<label class="flt-opt"><input type="checkbox" value="${escapeHtml(v)}" ${sel.includes(v) ? 'checked' : ''}><span>${filterValueName(f, v)}</span><small>${n}</small></label>`).join('')}</div>
    </details>`;
  }).join('');
  const chips = activeFilters().flatMap(f=> statsFilters[f.k].map(v=>
    `<button type="button" class="flt-chip" data-f="${f.k}" data-v="${escapeHtml(v)}" title="${t('Quitar filtro')}"><span>${f.label}:</span> ${filterValueName(f, v)} ${Icons.svg('x', 12)}</button>`)).join('');
  bar.innerHTML = `<div class="flt-row"><span class="flt-l">${Icons.svg('list-checks', 15)} ${t('Filtrar')}</span>${menus}</div>`
    + (chips ? `<div class="flt-active">${chips}<button type="button" class="link-btn" id="fltClear">${t('Limpiar filtros')}</button></div>` : '');
  bar.querySelectorAll('details.flt').forEach(d=> d.addEventListener('toggle', ()=>{
    if(d.open){
      openFilter = d.dataset.f;
      bar.querySelectorAll('details.flt[open]').forEach(o=>{ if(o !== d) o.open = false; });
      placeMenu(d);
    }
    else if(openFilter === d.dataset.f) openFilter = null;
  }));
  const openD = bar.querySelector('details.flt[open]');
  if(openD) placeMenu(openD);
  bar.querySelectorAll('.flt-opt input').forEach(inp=> inp.addEventListener('change', ()=> toggleFilter(inp.closest('details').dataset.f, inp.value, inp.checked)));
  bar.querySelectorAll('.flt-chip').forEach(c=> c.addEventListener('click', ()=> toggleFilter(c.dataset.f, c.dataset.v, false)));
  const clr = document.getElementById('fltClear');
  if(clr) clr.addEventListener('click', ()=>{ statsFilters = {}; openFilter = null; saveFilters(); renderAnalysis(); });
}
// Si el menú no entra a la derecha (celular), se alinea con el borde derecho del botón.
function placeMenu(d){
  const m = d.querySelector('.flt-menu');
  m.style.left = '0'; m.style.right = 'auto';
  if(m.getBoundingClientRect().right > document.documentElement.clientWidth - 8){ m.style.left = 'auto'; m.style.right = '0'; }
}
// Un clic afuera cierra el menú abierto.
document.addEventListener('click', e=>{
  if(openFilter && !e.target.closest('#statsFilters details.flt')){
    const d = document.querySelector(`#statsFilters details.flt[data-f="${openFilter}"]`);
    if(d) d.open = false;
    openFilter = null;
  }
});

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
    if(!p || !s.n) return `<div class="sk-d">${statsPeriod === 'all' ? t('Todo el historial') : t('Sin período anterior')}</div>`;
    if(Math.abs(d) < 0.05) return `<div class="sk-d">${t('= que {label}', {label})}</div>`;
    const txt = unit === 'pts' ? Math.round(Math.abs(d)) + ' ' + t('pts') : unit === '%' ? fix1(Math.abs(d)) + '%' : Math.abs(Math.round(d));
    return `<div class="sk-d ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '↑' : '↓'} ${t('{txt} vs {label}', {txt, label})}</div>`;
  };
  const prevLbl = PREV_LABELS[statsPeriod] || t('período anterior');
  const goal = goalPct();
  const card = (icon, tone, label, value, valCls, spark, d)=> `<div class="sk sk-${tone}">
    <div class="sk-top"><span class="sk-ic">${Icons.svg(icon, 16)}</span><span class="sk-l">${label}</span></div>
    <div class="sk-v ${valCls}">${value}</div>
    ${spark}${d}</div>`;
  document.getElementById('statsKpis').innerHTML = [
    card('trending-up', s.sum >= 0 ? 'good' : 'bad', t('Resultado acumulado'), s.n ? fmtSignedPct(s.sum) : '—', signClass(s.sum),
      Charts.spark(accS, s.sum >= 0 ? 'pos' : 'neg'), delta(p ? s.sum - p.sum : 0, '%', prevLbl)),
    card('shield-check', s.planPct >= goal ? 'good' : 'warn', t('Siguió el plan'), s.n ? Math.round(s.planPct) + '%' : '—', s.n ? (s.planPct >= goal ? 'pos' : 'warn') : '',
      Charts.spark(planS, s.planPct >= goal ? 'pos' : 'warn'), delta(p ? s.planPct - p.planPct : 0, 'pts', prevLbl)),
    card('target', 'info', t('Win rate'), s.n ? Math.round(s.winRate) + '%' : '—', '',
      Charts.spark(winS, 'info'), delta(p ? s.winRate - p.winRate : 0, 'pts', prevLbl)),
    card('chart-column', 'info', t('Trades'), s.n, '',
      Charts.spark(countS, 'info'), delta(p ? s.n - p.n : 0, 'n', prevLbl)),
  ].join('');

  const mini = (label, value)=> `<div class="sk2"><span>${label}</span><b>${value}</b></div>`;
  document.getElementById('statsSecondary').innerHTML = [
    mini(t('Resultado prom./trade'), s.n ? `<span class="${signClass(s.avg)}">${fmtSignedPct(s.avg)}</span>` : '—'),
    mini(t('Riesgo promedio'), s.avgRisk === null ? '—' : fix1(s.avgRisk) + '%'),
    mini(t('Duración promedio'), s.avgDur === null ? '—' : Math.round(s.avgDur) + ' min'),
    mini(t('R real promedio'), s.avgR === null ? '—' : `<span class="${signClass(s.avgR)}">${(s.avgR > 0 ? '+' : '') + s.avgR.toFixed(1)}R</span>`),
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
      <div class="ring-c"><b>${s.n ? Math.round(pct) + '%' : '—'}</b><span>${t('plan respetado')}</span></div>
    </div>
    <div class="ring-msg ${tone}">${!s.n ? t('Registrá trades para medir tu disciplina.') : pct >= goal ? `${Icons.svg('check', 14)} ${t('Estás arriba de tu meta del {goal}%', {goal})}` : `${Icons.svg('alert-triangle', 14)} ${t('Te faltan {n} pts para tu meta del {goal}%', {n: Math.ceil(goal - pct), goal})}`}</div>
    <div class="ring-stats">
      <div><b>${followed}/${s.n}</b><span>${t('trades en plan')}</span></div>
      <div><b>${currentStreak()}</b><span>${t('racha actual')}</span></div>
      <div><b>${state.bestStreak}</b><span>${t('mejor racha')}</span></div>
    </div>`;
}

// ---- 4. Curva ----
function drawCurve(){
  equityChart(document.getElementById('equityChart'), 280, periodLists().cur);
}
function renderCurveCard(cur){
  drawCurve();
  document.getElementById('curveMeta').textContent = cur.length ? tp(cur.length, '{n} trade', '{n} trades') : '';
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
  if(cur.length && diff > 0.05) hero = {tone: 'bad', icon: 'trending-down', big: t('Romper el plan te costó {n} puntos', {n: diff.toFixed(1)}),
    text: t('Resultado real {real} · con tu plan habrías hecho {plan}.', {real: fmtSignedPct(real[real.length - 1]), plan: fmtSignedPct(plan[plan.length - 1])})};
  else if(cur.length >= 3 && diff <= 0.05 && cur.every(h=> h.followedPlan)) hero = {tone: 'good', icon: 'sparkles', big: t('Respetaste tu plan en todos los trades'),
    text: t('Resultado del período: {real}. Así se construye un sistema medible.', {real: fmtSignedPct(real[real.length - 1])})};
  if(!list.length && !hero){
    box.innerHTML = `<div class="empty">${cur.length < 3 ? t('Con 3 trades o más en el período vas a empezar a ver patrones.') : t('Todavía no hay patrones claros. Registrá emoción, errores, activo y horario en cada trade: cuantos más datos, más patrones aparecen.')}</div>`;
    return;
  }
  const good = list.filter(i=> i.tone === 'good'), bad = list.filter(i=> i.tone === 'bad'), info = list.filter(i=> i.tone === 'info');
  const card = i=> `<div class="insight ${i.tone}"><span class="insight-ic">${Icons.svg(i.icon, 17)}</span><p>${i.text}</p></div>`;
  const col = (cls, icon, title, items, empty)=> `<div class="ins-col ${cls}">
    <div class="ins-col-t">${Icons.svg(icon, 15)} ${title}</div>
    ${items.length ? items.map(card).join('') : `<div class="ins-empty">${empty}</div>`}</div>`;
  box.innerHTML = (hero ? `<div class="ins-hero ${hero.tone}"><span class="ins-hero-ic">${Icons.svg(hero.icon, 24)}</span><div><b>${hero.big}</b><p>${hero.text}</p></div></div>` : '')
    + `<div class="ins-cols">${col('good', 'smile', t('Lo que te funciona'), good, t('Todavía no aparece un patrón positivo claro.'))}${col('bad', 'alert-triangle', t('Lo que te cuesta plata'), bad, t('No aparecen patrones que te estén costando.'))}</div>`
    + (info.length ? `<div class="ins-col info ins-info">${`<div class="ins-col-t">${Icons.svg('lightbulb', 15)} ${t('Para tener en cuenta')}</div>`}${info.map(card).join('')}</div>` : '');
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
    el.innerHTML = `<div class="empty">${t('Registrá trades con su hora de entrada para ver el mapa.')}</div>`;
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
    const html = `<div class="tip-h">${WEEKDAYS_ONE[di].charAt(0).toUpperCase() + WEEKDAYS_ONE[di].slice(1)} · ${t('{from}:00 a {to}:00 NY', {from: h, to: (h + 1) % 24})}</div>
      <div class="tip-r"><span>${t('Trades')}</span><b>${c.n}</b></div>
      <div class="tip-r"><span>${t('Plan seguido')}</span><b class="${planPct >= 80 ? 'pos' : planPct < 50 ? 'neg' : ''}">${planPct}%</b></div>
      <div class="tip-r"><span>${t('Resultado')}</span><b class="${signClass(c.sum)}">${fmtSignedPct(c.sum)}</b></div>`;
    cell.addEventListener('mousemove', e=> ChartTip.show(html, e.clientX, e.clientY));
    cell.addEventListener('mouseleave', ()=> ChartTip.hide());
    cell.addEventListener('click', e=> ChartTip.show(html, e.clientX, e.clientY));
  });
}

// ---- 7. Desglose ----
const BREAKDOWNS = {
  emotion: {label: t('Emoción'), key: h=> h.emotion, name: k=>{ const e = emotionById(k); return e ? e.label : k; }, empty: t('Marcá cómo te sentías al entrar en cada trade para ver este desglose.')},
  error: {label: t('Error'), key: h=> h.errors || [], name: k=>{ const e = errorById(k); return e ? e.label : k; }, empty: t('Todavía no marcaste errores en tus trades.')},
  session: {label: t('Sesión'), key: h=> sessionOf(h.ts), name: k=> k},
  asset: {label: t('Activo'), key: h=> h.asset, name: k=> escapeHtml(k), empty: t('Cargá el activo en tus trades para ver este desglose.')},
  setup: {label: t('Setup'), key: h=> h.setup, name: k=> escapeHtml(k), empty: t('Cargá el setup en tus trades para ver este desglose.')},
  direction: {label: t('Dirección'), key: h=> h.direction, name: k=> k === 'long' ? t('Long') : t('Short'), empty: t('Marcá si fue long o short para ver este desglose.')},
};
const BD_COLS = [['name', null], ['n', t('Trades')], ['planPct', t('Plan seguido')], ['winRate', t('Win rate')], ['avg', t('Prom./trade')], ['sum', t('Total')]];

function renderBreakdown(cur){
  cur = cur || periodLists().cur;
  const cfg = BREAKDOWNS[breakdownBy];
  document.querySelectorAll('#breakdownPills .pill').forEach(b=> b.classList.toggle('active', b.dataset.by === breakdownBy));
  const rows = Analytics.group(cur, cfg.key);
  const table = document.getElementById('breakdownTable');
  if(!rows.length){
    table.innerHTML = `<tr><td class="empty">${cfg.empty || t('Todavía no hay datos.')}</td></tr>`;
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
    <tbody>${rows.map(r=> `<tr class="bd-row ${r.key === best ? 'row-best' : r.key === worst ? 'row-worst' : ''}" data-v="${escapeHtml(breakdownBy === 'setup' ? normSetup(r.key) : r.key)}" title="${t('Tocá para filtrar por esto')}">
      <td><span class="bd-name">${cfg.name(r.key)}</span>${r.key === best ? `<span class="bd-tag good">${t('Mejor')}</span>` : r.key === worst ? `<span class="bd-tag bad">${t('Peor')}</span>` : ''}</td>
      <td>${r.n}</td>
      <td><div class="mini-bar ${r.planPct >= goalPct() ? '' : r.planPct >= 50 ? 'warn' : 'bad'}"><div style="width:${Math.round(r.planPct)}%"></div></div>${Math.round(r.planPct)}%</td>
      <td>${Math.round(r.winRate)}%</td>
      <td class="${signClass(r.avg)}">${fmtSignedPct(r.avg)}</td>
      <td><div class="div-bar"><div class="div-track"><div class="${r.sum >= 0 ? 'pos' : 'neg'}" style="width:${Math.abs(r.sum) / maxAbs * 50}%"></div></div><span class="${signClass(r.sum)}">${fmtSignedPct(r.sum)}</span></div></td>
    </tr>`).join('')}</tbody>`;
  table.querySelectorAll('tr.bd-row').forEach(tr=> tr.addEventListener('click', ()=>{
    toggleFilter(breakdownBy, tr.dataset.v, true);
    document.getElementById('statsFilters').scrollIntoView({behavior: 'smooth', block: 'start'});
  }));
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
  if(!cur.length){ box.innerHTML = `<div class="empty">${t('Todavía no hay trades en el período.')}</div>`; return; }
  const rows = [
    [t('Trades'), f.n, b.n, v=> v, (a, c)=> (a - c > 0 ? '+' : '') + (a - c)],
    [t('Prom./trade'), f.avg, b.avg, fmtSignedPct, (a, c)=> (a - c > 0 ? '+' : '') + (a - c).toFixed(1) + ' ' + t('pts')],
    [t('Win rate'), f.winRate, b.winRate, v=> Math.round(v) + '%', (a, c)=> (a - c > 0 ? '+' : '') + Math.round(a - c) + ' ' + t('pts')],
    [t('Duración'), f.avgDur, b.avgDur, v=> v === null ? '—' : Math.round(v) + ' min', (a, c)=> a === null || c === null ? '' : (a - c > 0 ? '+' : '') + Math.round(a - c) + ' min'],
    [t('Acumulado'), f.sum, b.sum, fmtSignedPct, (a, c)=> (a - c > 0 ? '+' : '') + (a - c).toFixed(1) + ' ' + t('pts')],
  ];
  box.innerHTML = `<div class="vs-head"><span class="vs-good">${Icons.svg('shield-check', 15)} ${t('Plan seguido')}</span><span></span><span class="vs-bad">${t('Plan roto')} ${Icons.svg('alert-triangle', 15)}</span></div>`
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
  if(!state.items.length){ box.innerHTML = `<div class="empty">${t('Armá tu Trading Plan en la pestaña Plan para ver qué reglas cumplís más.')}</div>`; return; }
  if(!cur.length){ box.innerHTML = `<div class="empty">${t('Todavía no hay trades en el período.')}</div>`; return; }
  // Cada regla se mide solo en los trades registrados después de crearla.
  const rows = state.items.map(it=>{
    const since = ruleCreatedAt(it);
    const list = cur.filter(h=> h.ts >= since || h.loggedAt >= since);
    const miss = list.filter(h=> (h.missingIds || []).includes(it.id) || (!h.missingIds && (h.missing || []).includes(it.label))).length;
    const c = list.length - miss;
    return {label: it.label, c, n: list.length, pct: list.length ? Math.round(c / list.length * 100) : 0};
  }).filter(r=> r.n).sort((a, b)=> b.pct - a.pct);
  if(!rows.length){ box.innerHTML = `<div class="empty">${t('Tus reglas actuales son más nuevas que los trades del período.')}</div>`; return; }
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
  const months = [{monthKey: curKey, label: monthLabel(), count: s.total, sum: s.sum, followedPct: s.pct, followedPctRaw: s.pctRaw, avgPerDay: s.avgPerDay, riskMgmtPct: s.riskMgmtPct, current: true}]
    .concat(closedMonthsList());
  const goal = goalPct();
  box.innerHTML = months.map(m=>{
    const tone = !m.count ? '' : m.sum > 0 ? 'pos' : m.sum < 0 ? 'neg' : '';
    const met = m.followedPctRaw >= goal;
    return `<div class="month ${tone} ${m.current ? 'current' : ''}">
      <div class="month-top"><span class="month-l">${m.label}</span>${m.current ? `<span class="month-tag">${t('En curso')}</span>` : `<span class="month-tag ${met ? 'good' : 'warn'}">${met ? t('Meta cumplida') : t('Meta no cumplida')}</span>`}</div>
      <div class="month-v ${tone}">${m.count ? fmtSignedPct(m.sum) : '—'}</div>
      <div class="month-plan"><span>${t('Plan seguido')}</span><b>${m.count ? m.followedPct + '%' : '—'}</b></div>
      <div class="month-bar"><div class="${met ? 'good' : 'warn'}" style="width:${m.count ? m.followedPct : 0}%"></div><i style="left:${goal}%"></i></div>
      <div class="month-stats">
        <span>${t('<b>{n}</b> trades', {n: m.count})}</span>
        <span>${t('<b>{n}</b> por día operado', {n: m.avgPerDay === null || m.avgPerDay === undefined ? '—' : m.avgPerDay.toFixed(1)})}</span>
        <span>${t('<b>{n}</b> risk mgmt', {n: m.riskMgmtPct === null || m.riskMgmtPct === undefined ? '—' : m.riskMgmtPct + '%'})}</span>
      </div>
      ${m.count ? `<div class="month-actions">
        <button type="button" class="small ghost" data-share-month="${m.monthKey}">${Icons.svg('upload', 14)} ${t('Compartir')}</button>
        <button type="button" class="small ghost" data-report-month="${m.monthKey}">${Icons.svg('file-down', 14)} ${t('Reporte PDF')}</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function renderAnalysis(){
  const {cur, prev} = periodLists();
  renderPeriodBar(cur);
  renderFilterBar();
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
