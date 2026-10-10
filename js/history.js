// Pestaña Historial: buscador, filtros, resumen, lista agrupada por día,
// panel de detalle de cada trade y exportación a CSV.

const PAGE_SIZE = 20;
const hx = {q: '', period: 'all', sort: 'date', result: null, plan: null, dir: null, errors: false, image: false, pending: false, limit: PAGE_SIZE};
let openTradeId = null;
let hxObserver = null;

function hxResult(h){
  if(h.resultPct !== null && h.resultPct !== undefined) return {txt: fmtSignedPct(h.resultPct), cls: signClass(h.resultPct)};
  if(h.result === 'win') return {txt: 'Ganador', cls: 'pos'};
  if(h.result === 'loss') return {txt: 'Perdedor', cls: 'neg'};
  return {txt: 'BE', cls: ''};
}
// Ganador / perdedor / BE según lo que se marcó en el trade (el mismo criterio que el win rate).
function hxTone(h){
  return h.result === 'win' ? 'win' : h.result === 'loss' ? 'loss' : 'be';
}

function filtersActive(){
  return !!(hx.q || hx.period !== 'all' || hx.result || hx.plan || hx.dir || hx.errors || hx.image || hx.pending);
}

function filteredTrades(){
  const q = hx.q.trim().toLowerCase();
  const weekStart = Analytics.weekStart(Date.now()).getTime();
  const monthStart = dayStartTs(monthKeyOf(Date.now()) + '-01');
  let list = viewTrades().filter(h=>{
    if(hx.period === 'week' && h.ts < weekStart) return false;
    if(hx.period === 'month' && h.ts < monthStart) return false;
    if(hx.result && hxTone(h) !== hx.result) return false;
    if(hx.plan === 'ok' && !h.followedPlan) return false;
    if(hx.plan === 'bad' && h.followedPlan) return false;
    if(hx.dir && h.direction !== hx.dir) return false;
    if(hx.errors && !(h.errors && h.errors.length)) return false;
    if(hx.image && !hasImage(h)) return false;
    if(hx.pending && !h.pending) return false;
    if(q && ![h.asset, h.setup, h.note].some(t=> t && t.toLowerCase().includes(q))) return false;
    return true;
  });
  const by = {
    'date': (a, b)=> b.ts - a.ts,
    'date-asc': (a, b)=> a.ts - b.ts,
    'result': (a, b)=> Analytics.pct(b) - Analytics.pct(a),
    'result-asc': (a, b)=> Analytics.pct(a) - Analytics.pct(b),
    'risk': (a, b)=> (b.riskPct || 0) - (a.riskPct || 0),
  }[hx.sort];
  return list.sort(by);
}

// ---- Controles ----
function renderHxControls(){
  document.querySelectorAll('#hxPeriod button').forEach(b=> b.classList.toggle('active', b.dataset.v === hx.period));
  document.querySelectorAll('#hxFilters .chip').forEach(c=>{
    const f = c.dataset.f;
    const on = f === 'errors' || f === 'image' || f === 'pending' ? hx[f] : hx[f] === c.dataset.v;
    c.classList.toggle('active', !!on);
  });
  document.getElementById('hxSort').value = hx.sort;
}

function resetHxFilters(){
  Object.assign(hx, {q: '', period: 'all', result: null, plan: null, dir: null, errors: false, image: false, pending: false, limit: PAGE_SIZE});
  document.getElementById('hxSearch').value = '';
  renderHistoryTab();
}

// ---- Resumen ----
function renderHxSummary(list){
  const s = Analytics.summary(list);
  const box = document.getElementById('hxSummary');
  const item = (label, value, cls = '')=> `<div class="hxs"><span>${label}</span><b class="${cls}">${value}</b></div>`;
  box.innerHTML = `<div class="hxs-items">
      ${item(filtersActive() ? 'Trades filtrados' : 'Trades', `${s.n}${filtersActive() ? `<small>/${viewTrades().length}</small>` : ''}`)}
      ${item('Resultado', s.n ? fmtSignedPct(s.sum) : '—', signClass(s.sum))}
      ${item('Plan seguido', s.n ? Math.round(s.planPct) + '%' : '—', !s.n ? '' : s.planPct >= goalPct() ? 'pos' : 'warn')}
      ${item('Win rate', s.n ? Math.round(s.winRate) + '%' : '—')}
    </div>
    <div class="hxs-actions">
      ${filtersActive() ? `<button type="button" class="ghost small" id="hxClear">${Icons.svg('x', 14)} Limpiar filtros</button>` : ''}
      ${!hx.pending && viewTrades().some(h=> h.pending) ? `<button type="button" class="small" id="hxPending">${viewTrades().filter(h=> h.pending).length} por completar</button>` : ''}
      <button type="button" class="small ghost" data-open-importer>${Icons.svg('file-up', 15)} Importar CSV</button>
      <button type="button" class="small" id="hxExport" ${s.n ? '' : 'disabled'}>${Icons.svg('file-down', 15)} Exportar CSV</button>
    </div>`;
  const pend = document.getElementById('hxPending');
  if(pend) pend.addEventListener('click', showPendingTrades);
  const clear = document.getElementById('hxClear');
  if(clear) clear.addEventListener('click', resetHxFilters);
  document.getElementById('hxExport').addEventListener('click', ()=> exportCsv(list));
}

// ---- Lista ----
function tradeRow(h, showDate){
  const r = hxResult(h);
  const rr = realR(h);
  const emo = emotionById(h.emotion);
  const errs = (h.errors || []).map(id=> errorById(id)).filter(Boolean);
  const tags = [];
  if(h.pending) tags.push('<span class="tag warn">Por completar</span>');
  tags.push(`<span class="tag ${h.followedPlan ? 'good' : 'bad'}">${h.followedPlan ? 'Plan seguido' : 'Plan roto'}</span>`);
  if(emo) tags.push(`<span class="tag ${emo.tone === 'risk' ? 'warn' : ''}">${emo.label}</span>`);
  errs.slice(0, 2).forEach(e=> tags.push(`<span class="tag bad">${e.label}</span>`));
  if(errs.length > 2) tags.push(`<span class="tag bad">+${errs.length - 2}</span>`);
  // Con todas las cuentas a la vista, cada trade dice de cuál es.
  const acc = state.viewAccount === 'all' && state.accounts.length > 1 ? accountById(h.accountId) : null;
  const meta = [acc && escapeHtml(acc.name), h.setup && escapeHtml(h.setup), sessionOf(h.ts), (showDate ? fmtDate(h.ts) + ' ' : '') + fmtTime(h.ts)].filter(Boolean).join(' · ');
  return `<button type="button" class="hx-row ${hxTone(h)}" data-id="${h.id}">
    <span class="hx-stripe"></span>
    <span class="hx-main">
      <span class="hx-title"><b>${h.asset ? escapeHtml(h.asset) : 'Trade'}</b>${h.direction ? `<span class="tp-dir ${h.direction}">${Icons.svg(h.direction === 'long' ? 'arrow-up' : 'arrow-down', 13)}${h.direction === 'long' ? 'Long' : 'Short'}</span>` : ''}</span>
      <span class="hx-meta">${meta}</span>
      <span class="hx-tags">${tags.join('')}</span>
    </span>
    ${hasImage(h) ? `<img class="hx-thumb" src="${tradeImage(h)}" alt="">` : ''}
    <span class="hx-res">
      <b class="${r.cls}">${r.txt}</b>
      <small>${rr !== null ? (rr > 0 ? '+' : '') + rr.toFixed(1) + 'R' : h.riskPct ? 'Riesgo ' + h.riskPct + '%' : ''}</small>
    </span>
    <span class="hx-chev">${Icons.svg('chevron-right', 16)}</span>
  </button>`;
}

function dayHeader(key, trades){
  const d = new Date(key + 'T00:00:00');
  const txt = d.toLocaleDateString('es-AR', {weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined});
  const sum = trades.reduce((a, h)=> a + Analytics.pct(h), 0);
  const broken = trades.filter(h=> !h.followedPlan).length;
  return `<div class="hx-day">
    <span class="hx-day-t">${txt.charAt(0).toUpperCase() + txt.slice(1)}</span>
    <span class="hx-day-m">${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}${broken ? ` · <span class="neg">${broken} fuera de plan</span>` : ''}</span>
    <b class="${signClass(sum)}">${fmtSignedPct(sum)}</b>
  </div>`;
}

function renderHistoryTab(){
  renderHxControls();
  const all = filteredTrades();
  renderHxSummary(all);
  const box = document.getElementById('hist');
  const more = document.getElementById('hxMore');
  if(!all.length){
    box.innerHTML = viewTrades().length
      ? `<div class="hx-empty"><span class="hx-empty-ic">${Icons.svg('search', 26)}</span><b>Ningún trade coincide con los filtros</b><p>Probá con otra búsqueda o sacá algún filtro.</p><button type="button" class="primary small" id="hxEmptyClear">Limpiar filtros</button></div>`
      : `<div class="hx-empty"><span class="hx-empty-ic">${Icons.svg('history', 26)}</span><b>Todavía no registraste ningún trade</b><p>Cada trade que cargues aparece acá con su resultado, tu plan, tu emoción y tus notas.</p><button type="button" class="primary small" data-goto="register">Registrar trade</button></div>`;
    const c = document.getElementById('hxEmptyClear');
    if(c) c.addEventListener('click', resetHxFilters);
    more.innerHTML = '';
    return;
  }
  const page = all.slice(0, hx.limit);
  let html = '';
  if(hx.sort.startsWith('date')){
    const groups = [];
    page.forEach(h=>{
      const k = dayKeyFromTs(h.ts);
      if(!groups.length || groups[groups.length - 1].k !== k) groups.push({k, trades: []});
      groups[groups.length - 1].trades.push(h);
    });
    html = groups.map(g=>{
      const dayAll = all.filter(h=> dayKeyFromTs(h.ts) === g.k);
      return `<div class="hx-group">${dayHeader(g.k, dayAll)}${g.trades.map(h=> tradeRow(h, false)).join('')}</div>`;
    }).join('');
  } else {
    html = `<div class="hx-group">${page.map(h=> tradeRow(h, true)).join('')}</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('.hx-row').forEach(b=> b.addEventListener('click', ()=> openTrade(b.dataset.id)));
  more.innerHTML = all.length > hx.limit
    ? `<span>Mostrando ${page.length} de ${all.length}</span><button type="button" class="small" id="hxMoreBtn">Cargar más</button>`
    : all.length > PAGE_SIZE ? `<span>Mostrando los ${all.length} trades</span>` : '';
  const btn = document.getElementById('hxMoreBtn');
  if(btn){
    btn.addEventListener('click', ()=>{ hx.limit += PAGE_SIZE; renderHistoryTab(); });
    if('IntersectionObserver' in window){
      if(hxObserver) hxObserver.disconnect();
      const io = hxObserver = new IntersectionObserver(entries=>{
        if(entries[0].isIntersecting && document.querySelector('.tabpage[data-tab="history"].active')){
          io.disconnect();
          hx.limit += PAGE_SIZE;
          renderHistoryTab();
        }
      }, {rootMargin: '200px'});
      io.observe(btn);
    }
  }
  if(openTradeId) renderTradePanel();
}

// ---- Panel de detalle ----
function openTrade(id){
  openTradeId = id;
  renderTradePanel();
  const panel = document.getElementById('tradePanel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeTrade(){
  openTradeId = null;
  const panel = document.getElementById('tradePanel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
}

function renderTradePanel(){
  const h = state.history.find(x=> x.id === openTradeId);
  if(!h){ closeTrade(); return; }
  const date = keyDate(dayKeyFromTs(h.ts)).toLocaleDateString('es-AR', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
  document.getElementById('tpKicker').textContent = date.charAt(0).toUpperCase() + date.slice(1) + ' · ' + fmtTimeBoth(h.ts);
  document.getElementById('tpTitle').innerHTML = `${h.asset ? escapeHtml(h.asset) : 'Trade'} ${h.direction ? `<span class="tp-dir ${h.direction}">${Icons.svg(h.direction === 'long' ? 'arrow-up' : 'arrow-down', 13)}${h.direction === 'long' ? 'Long' : 'Short'}</span>` : ''}`;

  const r = hxResult(h);
  const rr = realR(h);
  const cell = (l, v, cls = '')=> `<div><span class="ds-v ${cls}">${v}</span><span class="ds-l">${l}</span></div>`;
  // Reglas que existían cuando se registró el trade, más las que faltaron y después se borraron del plan.
  const missingIds = new Set(h.missingIds || []);
  const missingLabels = h.missing || [];
  const existed = state.items.filter(it=> ruleCreatedAt(it) <= Math.max(h.ts, h.loggedAt || 0) || missingIds.has(it.id));
  const isMiss = it=> missingIds.has(it.id) || (!h.missingIds && missingLabels.includes(it.label));
  const deleted = missingLabels.filter(l=> !existed.some(it=> it.label === l && isMiss(it)));
  const rules = existed.map(it=>{
      const miss = isMiss(it);
      return `<li class="${miss ? 'miss' : 'ok'}">${Icons.svg(miss ? 'x' : 'check', 14)}<span>${escapeHtml(it.label)}</span></li>`;
    }).join('')
    + deleted.map(l=> `<li class="miss">${Icons.svg('x', 14)}<span>${escapeHtml(l)} <small>(regla que ya no está en tu plan)</small></span></li>`).join('');
  const emo = emotionById(h.emotion);
  const errs = (h.errors || []).map(id=> errorById(id)).filter(Boolean);
  const maxRisk = getMaxDailyRisk();
  const riskBroken = maxRisk !== null && (dayRiskMap(h.accountId)[dayKeyFromTs(h.ts)] || 0) > maxRisk;
  const sec = (title, body)=> `<div class="tp-sec"><div class="tp-sec-t">${title}</div>${body}</div>`;

  document.getElementById('tpBody').innerHTML = `
    <div class="day-summary">
      ${cell('Resultado', r.txt, r.cls)}
      ${cell('R real', rr === null ? '—' : (rr > 0 ? '+' : '') + rr.toFixed(1) + 'R', signClass(rr || 0))}
      ${cell('R:R planeado', h.rrPlanned ? '1:' + h.rrPlanned : '—')}
      ${cell('Riesgo', h.riskPct !== null && h.riskPct !== undefined ? h.riskPct + '%' : '—')}
    </div>
    <div class="tp-chips">
      ${h.pending ? '<span class="tag warn">Importado · por completar</span>' : ''}
      ${typeof h.score === 'number' ? `<span class="tag ${h.score >= 80 ? 'good' : h.score >= 50 ? 'warn' : 'bad'}">Disciplina ${h.score}/100</span>` : ''}
      ${state.accounts.length > 1 && accountById(h.accountId) ? `<span class="tag strong">${escapeHtml(accountById(h.accountId).name)}</span>` : ''}
      <span class="tag">${sessionOf(h.ts)}</span>
      ${h.setup ? `<span class="tag">${escapeHtml(h.setup)}</span>` : ''}
      ${h.durationMin !== null && h.durationMin !== undefined ? `<span class="tag">${h.durationMin} min</span>` : ''}
      ${riskBroken ? '<span class="tag bad">Risk management roto ese día</span>' : ''}
    </div>
    ${hasImage(h) ? `<img class="tp-img" src="${tradeImage(h)}" alt="Captura del trade">` : ''}
    ${sec(`Trading Plan <span class="tag ${h.followedPlan ? 'good' : 'bad'}">${h.followedPlan ? 'Seguido' : 'Roto'}</span>`,
      rules ? `<ul class="tp-rules">${rules}</ul>` : '<p class="tp-muted">No tenías reglas cargadas.</p>')}
    ${sec('Tu cabeza', `<div class="tp-mind">
      <div><span class="tp-muted">Emoción</span><b class="${emo ? (emo.tone === 'risk' ? 'warn' : 'pos') : ''}">${emo ? emo.label : '—'}</b></div>
      <div><span class="tp-muted">Confianza</span>${h.confidence ? `<span class="tp-conf">${[1, 2, 3, 4, 5].map(i=> `<i class="${i <= h.confidence ? 'on' : ''}"></i>`).join('')}</span><b>${h.confidence}/5</b>` : '<b>—</b>'}</div>
    </div>
    ${errs.length ? `<div class="tags">${errs.map(e=> `<span class="tag bad">${e.label}</span>`).join('')}</div>` : '<p class="tp-muted">Sin errores marcados.</p>'}`)}
    ${sec('Qué pasó en el trade', h.note ? `<p class="tp-note">${escapeHtml(h.note).replace(/\n/g, '<br>')}</p>` : '<p class="tp-muted">Sin comentarios.</p>')}
  `;
  const img = document.querySelector('#tpBody .tp-img');
  if(img) img.addEventListener('click', ()=> openLightbox(tradeImage(h)));

  document.getElementById('tpFoot').innerHTML = `
    <button type="button" class="danger-o" id="tpDelete">${Icons.svg('trash', 15)} Eliminar</button>
    <button type="button" class="primary" id="tpEdit">${Icons.svg('pencil', 15)} Editar trade</button>`;
  document.getElementById('tpEdit').addEventListener('click', ()=>{
    const id = h.id;
    closeTrade();
    startEditTrade(id);
  });
  document.getElementById('tpDelete').addEventListener('click', ()=>{
    if(!confirm('¿Eliminar este trade? No se puede deshacer.')) return;
    state.history = state.history.filter(x=> x.id !== h.id);
    ImageStore.remove(h.imageId);
    // Si ese trade estaba abierto para editar, el formulario vuelve a cero.
    if(editingTradeId === h.id) resetForm();
    closeTrade();
    saveState();
    renderAll();
  });
}

document.querySelectorAll('[data-close-trade]').forEach(el=> el.addEventListener('click', closeTrade));
document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && openTradeId) closeTrade(); });

// ---- CSV ----
function exportCsv(list){
  const num = v=> v === null || v === undefined || v === '' ? '' : String(v).replace('.', ',');
  const cell = v=> {
    const t = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const head = ['Fecha', 'Hora (NY)', 'Cuenta', 'Activo', 'Dirección', 'Setup', 'Sesión', 'Resultado', 'Resultado %', 'Riesgo %', 'R:R planeado', 'R real', 'Duración (min)', 'Plan seguido', 'Reglas que faltaron', 'Emoción', 'Confianza', 'Errores', 'Nota'];
  const rows = list.map(h=>{
    const rr = realR(h);
    const emo = emotionById(h.emotion);
    return [
      fmtDate(h.ts), fmtTime(h.ts, NY_TZ), (accountById(h.accountId) || {}).name || '', h.asset || '', h.direction === 'long' ? 'Long' : h.direction === 'short' ? 'Short' : '',
      h.setup || '', sessionOf(h.ts), RESULT_LABELS[h.result] || '', num(h.resultPct), num(h.riskPct), num(h.rrPlanned),
      rr === null ? '' : num(rr.toFixed(2)), num(h.durationMin), h.followedPlan ? 'Sí' : 'No', (h.missing || []).join(' | '),
      emo ? emo.label : '', h.confidence || '', (h.errors || []).map(id=> (errorById(id) || {label: id}).label).join(' | '), h.note || '',
    ].map(cell).join(';');
  });
  const csv = '﻿' + [head.join(';')].concat(rows).join('\r\n');
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `journal-trading-${localDateStamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---- Eventos de los controles ----
let hxSearchTimer = null;
document.getElementById('hxSearch').addEventListener('input', e=>{
  clearTimeout(hxSearchTimer);
  hxSearchTimer = setTimeout(()=>{ hx.q = e.target.value; hx.limit = PAGE_SIZE; renderHistoryTab(); }, 150);
});
document.querySelectorAll('#hxPeriod button').forEach(b=> b.addEventListener('click', ()=>{ hx.period = b.dataset.v; hx.limit = PAGE_SIZE; renderHistoryTab(); }));
document.getElementById('hxSort').addEventListener('change', e=>{ hx.sort = e.target.value; hx.limit = PAGE_SIZE; renderHistoryTab(); });
document.querySelectorAll('#hxFilters .chip').forEach(c=> c.addEventListener('click', ()=>{
  const f = c.dataset.f;
  if(f === 'errors' || f === 'image' || f === 'pending') hx[f] = !hx[f];
  else hx[f] = hx[f] === c.dataset.v ? null : c.dataset.v;
  hx.limit = PAGE_SIZE;
  renderHistoryTab();
}));

// Historial filtrado en los trades importados que falta completar.
function showPendingTrades(){
  Object.assign(hx, {q: '', period: 'all', result: null, plan: null, dir: null, errors: false, image: false, pending: true, limit: PAGE_SIZE});
  document.getElementById('hxSearch').value = '';
  showTab('history');
  renderHistoryTab();
}

renderHistoryTab.tab = 'history';
onDataChange.push(renderHistoryTab);
renderOrDefer(renderHistoryTab);
