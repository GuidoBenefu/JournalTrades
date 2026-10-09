// Pestaña Estadísticas: curva de resultados, patrones, mapa de calor y desglose.

let breakdownBy = 'emotion';
const WEEKDAYS_ONE = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function renderCurveCard(){
  const {trades, real, plan} = Analytics.equityCurves();
  equityChart(document.getElementById('equityChart'), 260);
  const meta = document.getElementById('curveMeta');
  const cost = document.getElementById('curveCost');
  if(!trades.length){
    meta.textContent = '';
    cost.innerHTML = '';
    return;
  }
  const r = real[real.length - 1], p = plan[plan.length - 1];
  meta.textContent = `${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}`;
  const diff = p - r;
  cost.innerHTML = diff > 0.05
    ? `<b>Romper el plan te costó ${diff.toFixed(1)} puntos.</b> Resultado real: ${fmtSignedPct(r)} · Con tu plan: ${fmtSignedPct(p)}.`
    : diff < -0.05
      ? `Los trades fuera de plan sumaron ${fmtSignedPct(-diff)}, pero no son repetibles: un sistema que se rompe no se puede medir.`
      : `Resultado real: ${fmtSignedPct(r)}. Tus trades fuera de plan no cambiaron el resultado.`;
  cost.className = 'curve-cost ' + (diff > 0.05 ? 'bad' : '');
}

function renderHeatmap(){
  const el = document.getElementById('heatmap');
  const {cells, minH, maxH} = Analytics.heatmap();
  if(maxH < 0){
    el.innerHTML = '<div class="empty">Registrá trades con su hora de entrada para ver el mapa.</div>';
    el.style.gridTemplateColumns = '';
    return;
  }
  const from = Math.max(0, minH - 1), to = Math.min(23, maxH + 1);
  const hours = [];
  for(let h = from; h <= to; h++) hours.push(h);
  el.style.gridTemplateColumns = `44px repeat(${hours.length}, minmax(34px, 1fr))`;
  let html = '<div></div>' + hours.map(h=> `<div class="hm-h">${h}h</div>`).join('');
  WEEKDAYS.forEach((d, di)=>{
    html += `<div class="hm-d">${d}</div>`;
    hours.forEach(h=>{
      const c = cells[di + '-' + h];
      if(!c){ html += '<div class="hm-c"></div>'; return; }
      const brokenPct = c.broken / c.n * 100;
      const cls = brokenPct === 0 ? 'ok' : brokenPct < 50 ? 'warn' : 'bad';
      html += `<div class="hm-c ${cls}" title="${WEEKDAYS_ONE[di]} ${h}:00 · ${c.n} ${c.n === 1 ? 'trade' : 'trades'} · plan roto ${Math.round(brokenPct)}% · resultado ${fmtSignedPct(c.sum)}">${c.n}</div>`;
    });
  });
  el.innerHTML = html;
}

const BREAKDOWNS = {
  emotion: {label: 'Emoción', key: h=> h.emotion, name: k=>{ const e = emotionById(k); return e ? e.ic + ' ' + e.label : k; }, empty: 'Marcá cómo te sentías al entrar en cada trade para ver este desglose.'},
  error: {label: 'Error', key: h=> h.errors || [], name: k=>{ const e = errorById(k); return e ? e.label : k; }, empty: 'Todavía no marcaste errores en tus trades.'},
  session: {label: 'Sesión', key: h=> sessionOf(h.ts), name: k=> k},
  asset: {label: 'Activo', key: h=> h.asset, name: k=> escapeHtml(k), empty: 'Cargá el activo en tus trades para ver este desglose.'},
  setup: {label: 'Setup', key: h=> h.setup, name: k=> escapeHtml(k), empty: 'Cargá el setup en tus trades para ver este desglose.'},
  direction: {label: 'Dirección', key: h=> h.direction, name: k=> k === 'long' ? 'Long ↑' : 'Short ↓', empty: 'Marcá si fue long o short para ver este desglose.'},
};

function renderBreakdown(){
  const cfg = BREAKDOWNS[breakdownBy];
  document.querySelectorAll('#breakdownPills .pill').forEach(b=> b.classList.toggle('active', b.dataset.by === breakdownBy));
  const rows = Analytics.group(state.history, cfg.key).sort((a, b)=> b.n - a.n);
  const table = document.getElementById('breakdownTable');
  if(!rows.length){
    table.innerHTML = `<tr><td class="empty">${cfg.empty || 'Todavía no hay datos.'}</td></tr>`;
    return;
  }
  const cls = v=> v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  table.innerHTML = `
    <thead><tr><th>${cfg.label}</th><th>Trades</th><th>Plan seguido</th><th>Win rate</th><th>Prom./trade</th><th>Total</th></tr></thead>
    <tbody>${rows.map(r=> `<tr>
      <td>${cfg.name(r.key)}</td>
      <td>${r.n}</td>
      <td><div class="mini-bar"><div style="width:${Math.round(r.planPct)}%"></div></div>${Math.round(r.planPct)}%</td>
      <td>${Math.round(r.winRate)}%</td>
      <td class="${cls(r.avg)}">${fmtSignedPct(r.avg)}</td>
      <td class="${cls(r.sum)}">${fmtSignedPct(r.sum)}</td>
    </tr>`).join('')}</tbody>`;
}

document.querySelectorAll('#breakdownPills .pill').forEach(b=> b.addEventListener('click', ()=>{
  breakdownBy = b.dataset.by;
  renderBreakdown();
}));

function renderAnalysis(){
  renderCurveCard();
  renderInsightList(document.getElementById('allInsights'), Analytics.insights(),
    state.history.length < 3 ? 'Con 3 trades o más vas a empezar a ver patrones de tu operativa.' : 'Todavía no hay patrones claros. Registrá emoción, errores, activo y horario en cada trade: cuantos más datos, más patrones aparecen.');
  renderHeatmap();
  renderBreakdown();
}

onDataChange.push(renderAnalysis);
Charts.register(()=> equityChart(document.getElementById('equityChart'), 260));
renderAnalysis();
