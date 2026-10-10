// Pestaña Calendario: vista mensual o anual, modo Resultado o Disciplina,
// resumen del período y panel con el detalle de cada día.

// Año y mes (0-11) del día de trading actual, en hora de Nueva York.
function currentYM(){
  const k = currentDayKey();
  return [Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1];
}

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const cal = {
  date: new Date(currentYM()[0], currentYM()[1], 1),
  scope: 'month',   // 'month' | 'year'
  mode: 'result',   // 'result' | 'plan'
  openDay: null,    // clave AAAA-MM-DD del panel abierto
};

function dayStats(){
  const days = {};
  viewTrades().forEach(h=>{
    const k = dayKeyFromTs(h.ts);
    if(!days[k]) days[k] = {trades: [], sum: 0, followed: 0};
    days[k].trades.push(h);
    days[k].sum += Analytics.pct(h);
    if(h.followedPlan) days[k].followed++;
  });
  Object.values(days).forEach(d=>{
    d.n = d.trades.length;
    d.planPct = d.followed / d.n * 100;
    d.trades.sort((a, b)=> a.ts - b.ts);
  });
  return days;
}

const keyOf = (y, m, d)=> y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');

// Fondo de una celda: más intenso cuanto más grande el resultado.
function cellStyle(d, maxAbs){
  if(!d) return '';
  if(cal.mode === 'plan'){
    const color = d.planPct === 100 ? 'var(--brand)' : d.planPct === 0 ? 'var(--danger)' : 'var(--amber)';
    return `background:color-mix(in srgb, ${color} 28%, var(--card)); border-color:${color};`;
  }
  if(Math.abs(d.sum) < 0.05) return 'border-color:var(--border-strong);';
  const color = d.sum > 0 ? 'var(--brand)' : 'var(--danger)';
  const alpha = Math.round(12 + 33 * Math.min(Math.abs(d.sum) / maxAbs, 1));
  return `background:color-mix(in srgb, ${color} ${alpha}%, var(--card)); border-color:color-mix(in srgb, ${color} 70%, var(--card));`;
}

function dotsHtml(trades){
  const max = 5;
  const dots = trades.slice(0, max).map(h=> `<i class="${h.followedPlan ? 'ok' : 'bad'}"></i>`).join('');
  return `<div class="cd-dots">${dots}${trades.length > max ? `<span>+${trades.length - max}</span>` : ''}</div>`;
}

function valueText(d){
  return cal.mode === 'plan' ? Math.round(d.planPct) + '%' : fmtSignedPct(d.sum);
}


// ---------- Resumen ----------

function summaryTile(label, value, sub, cls = ''){
  return `<div class="cs-tile"><div class="cs-l">${label}</div><div class="cs-v ${cls}">${value}</div><div class="cs-s">${sub}</div></div>`;
}

function renderSummary(dayList, periodLabel, extra){
  const box = document.getElementById('calSummary');
  const trades = dayList.flatMap(([, d])=> d.trades);
  if(!trades.length){
    box.innerHTML = `<div class="cs-empty">No registraste trades en ${periodLabel}.</div>`;
    return;
  }
  const sum = trades.reduce((a, h)=> a + Analytics.pct(h), 0);
  const green = dayList.filter(([, d])=> d.sum > 0.05).length;
  const red = dayList.filter(([, d])=> d.sum < -0.05).length;
  const planPct = trades.filter(h=> h.followedPlan).length / trades.length * 100;
  const tiles = [
    summaryTile('Resultado', fmtSignedPct(sum), `${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}`, signClass(sum)),
    summaryTile('Días operados', dayList.length, `${green} verdes · ${red} rojos`),
    summaryTile('Plan seguido', Math.round(planPct) + '%', `Meta: ${goalPct()}%`, planPct >= goalPct() ? 'pos' : 'warn'),
  ].concat(extra(dayList));
  box.innerHTML = tiles.join('');
}

function bestWorstDays(dayList){
  if(!dayList.length) return [];
  const sorted = dayList.slice().sort((a, b)=> b[1].sum - a[1].sum);
  const fmtDay = k=> new Date(k + 'T00:00:00').toLocaleDateString(LOCALE, {weekday: 'short', day: 'numeric'});
  const [bk, bd] = sorted[0], [wk, wd] = sorted[sorted.length - 1];
  // Racha de días operados en verde dentro del período.
  let run = 0, best = 0;
  dayList.slice().sort((a, b)=> a[0] < b[0] ? -1 : 1).forEach(([, d])=>{ run = d.sum > 0.05 ? run + 1 : 0; best = Math.max(best, run); });
  return [
    summaryTile('Mejor día', fmtSignedPct(bd.sum), fmtDay(bk), signClass(bd.sum)),
    summaryTile('Peor día', fmtSignedPct(wd.sum), fmtDay(wk), signClass(wd.sum)),
    summaryTile('Días en verde', best + (best === 1 ? ' día' : ' días'), 'Días seguidos en verde', best > 0 ? 'pos' : ''),
  ];
}

// ---------- Vista mensual ----------

function renderMonth(days){
  const y = cal.date.getFullYear(), m = cal.date.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;
  const todayKey = dayKeyFromTs(Date.now());
  const monthDays = [];
  for(let d = 1; d <= daysInMonth; d++){
    const k = keyOf(y, m, d);
    if(days[k]) monthDays.push([k, days[k]]);
  }
  const maxAbs = Math.max(0.5, ...monthDays.map(([, d])=> Math.abs(d.sum)));

  let html = '<div class="cal-grid">' + WEEKDAYS.map(d=> `<div class="cal-dow">${d}</div>`).join('') + '<div class="cal-dow">Semana</div>';
  let col = 0, week = [];
  const flushWeek = ()=>{
    const trades = week.flatMap(d=> d.trades);
    if(!trades.length){
      html += '<div class="cal-week empty"><span>—</span></div>';
    } else {
      const sum = trades.reduce((a, h)=> a + Analytics.pct(h), 0);
      const plan = trades.filter(h=> h.followedPlan).length / trades.length * 100;
      html += `<div class="cal-week">
        <div class="cw-v ${cal.mode === 'plan' ? '' : signClass(sum)}">${cal.mode === 'plan' ? Math.round(plan) + '%' : fmtSignedPct(sum)}</div>
        <div class="cw-s">${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}<span class="cw-plan"> · ${cal.mode === 'plan' ? fmtSignedPct(sum) : Math.round(plan) + '% plan'}</span></div>
      </div>`;
    }
    week = [];
  };
  const pushCell = cell=>{
    html += cell;
    col++;
    if(col % 7 === 0) flushWeek();
  };
  for(let i = 0; i < offset; i++) pushCell('<div class="cal-day out"></div>');
  for(let d = 1; d <= daysInMonth; d++){
    const k = keyOf(y, m, d);
    const data = days[k];
    if(data) week.push(data);
    const isToday = k === todayKey;
    const future = k > todayKey;
    const cls = ['cal-day', data ? 'has' : (future ? 'future' : 'idle'), isToday ? 'today' : ''].join(' ');
    pushCell(`<button type="button" class="${cls}" data-day="${k}" ${future ? 'disabled' : ''} style="${cellStyle(data, maxAbs)}">
      <div class="cd-top"><span class="cd-num">${d}</span>${data ? `<span class="cd-n">${data.n}</span>` : ''}</div>
      ${data ? `<div class="cd-val">${valueText(data)}</div>${dotsHtml(data.trades)}` : ''}
    </button>`);
  }
  while(col % 7 !== 0) pushCell('<div class="cal-day out"></div>');
  html += '</div>';
  document.getElementById('calView').innerHTML = html;
  document.querySelectorAll('#calView .cal-day[data-day]:not([disabled])').forEach(b=> b.addEventListener('click', ()=> openDay(b.dataset.day)));

  renderSummary(monthDays, MONTHS[m].toLowerCase(), bestWorstDays);
}

// ---------- Vista anual ----------

function renderYear(days){
  const y = cal.date.getFullYear();
  const todayKey = dayKeyFromTs(Date.now());
  const yearDays = Object.entries(days).filter(([k])=> k.startsWith(y + '-'));
  const maxAbs = Math.max(0.5, ...yearDays.map(([, d])=> Math.abs(d.sum)));
  let html = '<div class="year-grid">';
  const months = [];
  for(let m = 0; m < 12; m++){
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const mDays = yearDays.filter(([k])=> Number(k.slice(5, 7)) === m + 1);
    const trades = mDays.flatMap(([, d])=> d.trades);
    const sum = trades.reduce((a, h)=> a + Analytics.pct(h), 0);
    const plan = trades.length ? trades.filter(h=> h.followedPlan).length / trades.length * 100 : 0;
    months.push({m, sum, n: trades.length, plan});
    let cells = '';
    for(let i = 0; i < offset; i++) cells += '<i class="out"></i>';
    for(let d = 1; d <= daysInMonth; d++){
      const k = keyOf(y, m, d);
      const data = days[k];
      cells += `<i class="${data ? 'has' : k > todayKey ? 'future' : ''}" style="${cellStyle(data, maxAbs)}" title="${d} de ${MONTHS[m].toLowerCase()}${data ? ' · ' + valueText(data) + ' · ' + data.n + (data.n === 1 ? ' trade' : ' trades') : ''}"></i>`;
    }
    html += `<button type="button" class="year-month" data-month="${m}">
      <div class="ym-head"><span class="ym-name">${MONTHS[m]}</span>${trades.length ? `<span class="ym-val ${cal.mode === 'plan' ? '' : signClass(sum)}">${cal.mode === 'plan' ? Math.round(plan) + '%' : fmtSignedPct(sum)}</span>` : ''}</div>
      <div class="ym-grid">${cells}</div>
      <div class="ym-sub">${trades.length ? `${trades.length} ${trades.length === 1 ? 'trade' : 'trades'} · ${mDays.length} ${mDays.length === 1 ? 'día' : 'días'}` : 'Sin trades'}</div>
    </button>`;
  }
  html += '</div>';
  document.getElementById('calView').innerHTML = html;
  document.querySelectorAll('#calView .year-month').forEach(b=> b.addEventListener('click', ()=>{
    cal.date = new Date(y, Number(b.dataset.month), 1);
    cal.scope = 'month';
    renderCalendarTab();
  }));

  renderSummary(yearDays, String(y), ()=>{
    const active = months.filter(x=> x.n);
    if(!active.length) return [];
    const sorted = active.slice().sort((a, b)=> b.sum - a.sum);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const positive = active.filter(x=> x.sum > 0.05).length;
    return [
      summaryTile('Mejor mes', fmtSignedPct(best.sum), MONTHS[best.m], signClass(best.sum)),
      summaryTile('Peor mes', fmtSignedPct(worst.sum), MONTHS[worst.m], signClass(worst.sum)),
      summaryTile('Meses en verde', `${positive} de ${active.length}`, 'Meses con trades', positive ? 'pos' : ''),
    ];
  });
}

// ---------- Controles ----------

function renderControls(){
  const y = cal.date.getFullYear();
  const [nowY, nowM] = currentYM();
  const firstYear = Math.min(nowY, ...viewTrades().map(h=> Number(dayKeyFromTs(h.ts).slice(0, 4))));
  const years = [];
  for(let yy = nowY; yy >= firstYear; yy--) years.push(yy);
  if(!years.includes(y)) years.push(y);
  document.getElementById('calYear').innerHTML = years.sort((a, b)=> b - a).map(yy=> `<option value="${yy}" ${yy === y ? 'selected' : ''}>${yy}</option>`).join('');
  document.getElementById('calMonth').innerHTML = MONTHS.map((n, i)=> `<option value="${i}" ${i === cal.date.getMonth() ? 'selected' : ''}>${n}</option>`).join('');
  document.getElementById('calMonth').style.display = cal.scope === 'month' ? '' : 'none';
  document.querySelectorAll('#calScope button').forEach(b=> b.classList.toggle('active', b.dataset.v === cal.scope));
  document.querySelectorAll('#calMode button').forEach(b=> b.classList.toggle('active', b.dataset.v === cal.mode));
  const atCurrent = cal.scope === 'month'
    ? (y === nowY && cal.date.getMonth() === nowM)
    : y === nowY;
  document.getElementById('calNext').disabled = atCurrent;
  document.getElementById('calToday').disabled = atCurrent;

  document.getElementById('calLegend').innerHTML = cal.mode === 'plan'
    ? '<span><i class="lg-sq" style="background:color-mix(in srgb, var(--brand) 28%, var(--card)); border-color:var(--brand)"></i>Plan siempre seguido</span><span><i class="lg-sq" style="background:color-mix(in srgb, var(--amber) 28%, var(--card)); border-color:var(--amber)"></i>A veces roto</span><span><i class="lg-sq" style="background:color-mix(in srgb, var(--danger) 28%, var(--card)); border-color:var(--danger)"></i>Siempre roto</span><span><i class="lg-dot ok"></i>Trade con plan seguido</span><span><i class="lg-dot"></i>Plan roto</span>'
    : '<span class="lg-scale">Pérdida <i style="background:color-mix(in srgb, var(--danger) 45%, var(--card))"></i><i style="background:color-mix(in srgb, var(--danger) 18%, var(--card))"></i><i style="background:var(--card)"></i><i style="background:color-mix(in srgb, var(--brand) 18%, var(--card))"></i><i style="background:color-mix(in srgb, var(--brand) 45%, var(--card))"></i> Ganancia</span><span><i class="lg-dot ok"></i>Trade con plan seguido</span><span><i class="lg-dot"></i>Plan roto</span>';
}

function renderCalendarTab(){
  const days = dayStats();
  renderControls();
  if(cal.scope === 'year') renderYear(days); else renderMonth(days);
  if(cal.openDay) renderDayPanel();
}

function shift(dir){
  cal.date = cal.scope === 'month'
    ? new Date(cal.date.getFullYear(), cal.date.getMonth() + dir, 1)
    : new Date(cal.date.getFullYear() + dir, cal.date.getMonth(), 1);
  renderCalendarTab();
}

document.getElementById('calPrev').addEventListener('click', ()=> shift(-1));
document.getElementById('calNext').addEventListener('click', ()=> shift(1));
document.getElementById('calToday').addEventListener('click', ()=>{
  cal.date = new Date(currentYM()[0], currentYM()[1], 1);
  renderCalendarTab();
});
document.getElementById('calMonth').addEventListener('change', e=>{
  cal.date = new Date(cal.date.getFullYear(), Number(e.target.value), 1);
  renderCalendarTab();
});
document.getElementById('calYear').addEventListener('change', e=>{
  cal.date = new Date(Number(e.target.value), cal.date.getMonth(), 1);
  renderCalendarTab();
});
document.querySelectorAll('#calScope button').forEach(b=> b.addEventListener('click', ()=>{ cal.scope = b.dataset.v; renderCalendarTab(); }));
document.querySelectorAll('#calMode button').forEach(b=> b.addEventListener('click', ()=>{ cal.mode = b.dataset.v; renderCalendarTab(); }));

// ---------- Panel del día ----------

function openDay(key){
  cal.openDay = key;
  renderDayPanel();
  const panel = document.getElementById('dayPanel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closeDay(){
  cal.openDay = null;
  const panel = document.getElementById('dayPanel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
}

function renderDayPanel(){
  const key = cal.openDay;
  const date = new Date(key + 'T00:00:00');
  const d = dayStats()[key];
  const title = date.toLocaleDateString(LOCALE, {weekday: 'long', day: 'numeric', month: 'long'});
  document.getElementById('dayKicker').textContent = date.getFullYear();
  document.getElementById('dayTitle').textContent = title.charAt(0).toUpperCase() + title.slice(1);
  const body = document.getElementById('dayBody');
  if(!d){
    body.innerHTML = `<div class="day-empty"><div class="day-empty-ic">${Icons.svg('inbox', 30)}</div><p>No registraste trades este día.</p></div>`;
    return;
  }
  const wins = d.trades.filter(h=> h.result === 'win').length;
  const rs = d.trades.map(realR).filter(r=> r !== null);
  const summary = `<div class="day-summary">
    <div><span class="ds-v ${signClass(d.sum)}">${fmtSignedPct(d.sum)}</span><span class="ds-l">Resultado</span></div>
    <div><span class="ds-v">${d.n}</span><span class="ds-l">${d.n === 1 ? 'Trade' : 'Trades'}</span></div>
    <div><span class="ds-v ${d.planPct === 100 ? 'pos' : d.planPct < 50 ? 'neg' : 'warn'}">${Math.round(d.planPct)}%</span><span class="ds-l">Plan seguido</span></div>
    <div><span class="ds-v">${rs.length ? (rs.reduce((a, b)=> a + b, 0) >= 0 ? '+' : '') + rs.reduce((a, b)=> a + b, 0).toFixed(1) + 'R' : wins + '/' + d.n}</span><span class="ds-l">${rs.length ? 'R total' : 'Ganadores'}</span></div>
  </div>`;
  const list = d.trades.map(h=>{
    const emo = emotionById(h.emotion);
    const r = realR(h);
    return `<div class="dtrade">
      <div class="dt-top">
        <div class="dt-main">
          <span class="dt-time">${fmtTime(h.ts)}</span>
          <b>${escapeHtml(h.asset || 'Trade')}</b>
          ${h.direction ? `<span class="dt-dir">${h.direction === 'long' ? 'Long ↑' : 'Short ↓'}</span>` : ''}
        </div>
        <span class="dt-res ${signClass(Analytics.pct(h))}">${h.resultPct === null || h.resultPct === undefined ? '—' : fmtSignedPct(h.resultPct)}</span>
      </div>
      <div class="tags">
        <span class="tag ${h.followedPlan ? 'good' : 'bad'}">${h.followedPlan ? 'Plan seguido' : 'Plan roto'}</span>
        <span class="tag">${sessionOf(h.ts)}</span>
        ${h.setup ? `<span class="tag">${escapeHtml(h.setup)}</span>` : ''}
        ${emo ? `<span class="tag">${emo.label}</span>` : ''}
        ${r !== null ? `<span class="tag">${r > 0 ? '+' : ''}${r.toFixed(1)}R</span>` : ''}
        ${(h.errors || []).map(id=> errorById(id)).filter(Boolean).map(e=> `<span class="tag bad">${e.label}</span>`).join('')}
      </div>
      ${h.missing && h.missing.length ? `<div class="dt-miss">Faltó del plan: ${h.missing.map(escapeHtml).join(', ')}</div>` : ''}
      ${h.note ? `<p class="dt-note">${escapeHtml(h.note)}</p>` : ''}
      ${hasImage(h) ? `<img src="${tradeImage(h)}" class="tradeThumb dayThumb" alt="Captura del trade">` : ''}
      <div class="dt-actions"><button type="button" class="small" data-open-trade="${h.id}">Ver detalle</button></div>
    </div>`;
  }).join('');
  body.innerHTML = summary + list;
  // Igual que en Inicio, Historial y Revisión: tocar un trade abre su detalle.
  body.querySelectorAll('[data-open-trade]').forEach(b=> b.addEventListener('click', ()=>{
    closeDay();
    openTrade(b.dataset.openTrade);
  }));
  body.querySelectorAll('.dayThumb').forEach(img=> img.addEventListener('click', ()=> openLightbox(img.src)));
}

document.querySelectorAll('[data-close-day]').forEach(el=> el.addEventListener('click', closeDay));
document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && cal.openDay) closeDay(); });

document.getElementById('dayAddTrade').addEventListener('click', ()=>{
  const key = cal.openDay;
  closeDay();
  resetForm();
  // Mismo horario de ahora, pero en el día elegido. Si con la zona o el cierre
  // del día esa hora cae en otro día de trading, se usa el mediodía de NY.
  const now = zoneParts(Date.now(), displayTz());
  const [y, m, d] = key.split('-').map(Number);
  let when = zonedToTs(y, m, d, now.h, now.min, displayTz());
  if(dayKeyFromTs(when) !== key) when = zonedToTs(y, m, d, 12, 0, NY_TZ);
  document.getElementById('entryTimeInput').value = toLocalInputValue(Math.min(when, Date.now()));
  // Si eligió otro día, esa fecha se respeta al guardar.
  entryTimeTouched = key !== dayKeyFromTs(Date.now());
  renderFormHints();
  showTab('register');
});

renderCalendarTab.tab = 'calendar';
onDataChange.push(renderCalendarTab);
renderOrDefer(renderCalendarTab);
