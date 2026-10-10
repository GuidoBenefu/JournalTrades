// Pestaña Revisión: resumen automático de la semana, preguntas guiadas,
// historial de revisiones y aviso en Inicio. Las respuestas se guardan en
// state.reviews por semana (clave = lunes).

let reviewWeek = Analytics.weekKey(Date.now());
let reviewScore = null;
// Borrador: si hay cambios sin guardar en la semana abierta, los re-render no los pisan.
let reviewFormWeek = null;
let reviewDirty = false;
const reviewDrafts = {};

function reviewFormValues(){
  return {good: document.getElementById('rvGood').value, error: document.getElementById('rvError').value,
    change: document.getElementById('rvChange').value, score: reviewScore};
}

function shiftWeek(key, n){ return addDaysKey(key, n * 7); }

function weekLabel(key){
  const start = new Date(key + 'T00:00:00');
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const f = d=> d.toLocaleDateString(LOCALE, {day: 'numeric', month: 'short'});
  return `${f(start)} – ${f(end)}`;
}

function earliestWeek(){
  const keys = viewTrades().map(h=> Analytics.weekKey(h.ts)).concat(Object.keys(state.reviews));
  return keys.length ? keys.sort()[0] : Analytics.weekKey(Date.now());
}

function scoreTone(v){ return v >= 7 ? 'good' : v >= 5 ? 'warn' : 'bad'; }
function scoreWord(v){ return v >= 9 ? t('Excelente') : v >= 6 ? t('Sólida') : v >= 4 ? t('Regular') : t('Floja'); }

// Semanas seguidas con revisión, contando desde esta semana (si ya está) o la anterior.
function reviewStreak(){
  let key = Analytics.weekKey(Date.now());
  if(!state.reviews[key]) key = shiftWeek(key, -1);
  let n = 0;
  while(state.reviews[key]){ n++; key = shiftWeek(key, -1); }
  return n;
}

// Semana que conviene revisar hoy: el domingo la actual, el lunes la anterior.
function weekToReviewToday(){
  const day = weekdayOf(Date.now());
  if(day === 6) return Analytics.weekKey(Date.now());
  if(day === 0) return shiftWeek(Analytics.weekKey(Date.now()), -1);
  return null;
}

// ---- Encabezado ----
function renderReviewHeader(){
  const thisWeek = Analytics.weekKey(Date.now());
  const k = reviewWeek === thisWeek ? t('Esta semana') : reviewWeek === shiftWeek(thisWeek, -1) ? t('Semana pasada') : t('Semana');
  document.getElementById('reviewKicker').textContent = k;
  document.getElementById('reviewTitle').textContent = weekLabel(reviewWeek);
  document.getElementById('rvNext').disabled = reviewWeek >= thisWeek;
  document.getElementById('rvPrev').disabled = reviewWeek <= earliestWeek();

  const st = document.getElementById('reviewStatus');
  const done = !!state.reviews[reviewWeek];
  st.className = 'rv-status ' + (done ? 'good' : 'warn');
  st.innerHTML = done ? `${Icons.svg('check', 13)} ${t('Revisada')}` : `${Icons.svg('clock', 13)} ${t('Pendiente')}`;

  const streak = reviewStreak();
  const sk = document.getElementById('reviewStreak');
  sk.style.display = streak ? '' : 'none';
  sk.innerHTML = `${Icons.svg('flame', 13)} ${tp(streak, '1 semana revisada', '{n} semanas seguidas revisando')}`;

  // Compromiso de la semana anterior
  const prev = state.reviews[shiftWeek(reviewWeek, -1)];
  const box = document.getElementById('rvCommit');
  if(prev && prev.change){
    box.style.display = '';
    box.innerHTML = `<span class="rv-commit-ic">${Icons.svg('target', 18)}</span>
      <div><div class="rv-commit-l">${t('Tu compromiso para esta semana')}</div><div class="rv-commit-t">${escapeHtml(prev.change)}</div></div>`;
  } else box.style.display = 'none';
}

// ---- Números con comparación ----
function renderReviewSummary(){
  const trades = Analytics.tradesOfWeek(reviewWeek);
  const s = Analytics.summary(trades);
  const p = Analytics.summary(Analytics.tradesOfWeek(shiftWeek(reviewWeek, -1)));
  const goal = goalPct();
  const delta = (cur, prev, unit, inverse)=>{
    if(!s.n || !p.n) return `<div class="rk-d">${t('Sin semana previa para comparar')}</div>`;
    const d = cur - prev;
    if(Math.abs(d) < 0.05) return `<div class="rk-d">${t('= que la semana pasada')}</div>`;
    const good = inverse ? d < 0 : d > 0;
    const txt = unit === 'pts' ? Math.round(Math.abs(d)) + ' ' + t('pts') : unit === '%' ? fix1(Math.abs(d)) + '%' : Math.abs(d);
    return `<div class="rk-d ${good ? 'pos' : 'neg'}">${d > 0 ? '↑' : '↓'} ${t('{txt} vs semana pasada', {txt})}</div>`;
  };
  const kpi = (label, value, cls, extra)=> `<div class="rk ${cls || ''}"><div class="rk-l">${label}</div><div class="rk-v">${value}</div>${extra}</div>`;
  const planCls = !s.n ? '' : s.planPct >= goal ? 'good' : 'warn';
  document.getElementById('reviewSummary').innerHTML = [
    kpi(t('Trades'), s.n, '', s.n && p.n ? `<div class="rk-d">${t('{n} la semana pasada', {n: p.n})}</div>` : '<div class="rk-d">&nbsp;</div>'),
    kpi(t('Siguió el plan'), s.n ? Math.round(s.planPct) + '%' : '—', planCls,
      `<div class="rk-bar"><div style="width:${s.n ? s.planPct : 0}%"></div><i style="left:${goal}%" title="${t('Meta {goal}%', {goal})}"></i></div>` + delta(s.planPct, p.planPct, 'pts')),
    kpi(t('Resultado'), s.n ? fmtSignedPct(s.sum) : '—', !s.n ? '' : s.sum > 0 ? 'pos' : s.sum < 0 ? 'neg' : '', delta(s.sum, p.sum, '%')),
    kpi(t('Win rate'), s.n ? Math.round(s.winRate) + '%' : '—', '', delta(s.winRate, p.winRate, 'pts')),
  ].join('');
}

// ---- Gráfico por día ----
function renderReviewChart(){
  const days = WEEKDAYS.map((name, i)=>{
    const key = addDaysKey(reviewWeek, i);
    const list = viewTrades().filter(h=> dayKeyFromTs(h.ts) === key);
    return {name, n: list.length, sum: list.reduce((a, h)=> a + Analytics.pct(h), 0), broke: list.some(h=> !h.followedPlan)};
  });
  const max = Math.max(...days.map(d=> Math.abs(d.sum)), 0.1);
  document.getElementById('reviewChart').innerHTML = days.map(d=>{
    const h = d.n ? Math.max(4, Math.abs(d.sum) / max * 100) : 0;
    const cls = d.sum > 0 ? 'pos' : d.sum < 0 ? 'neg' : 'zero';
    return `<div class="rc-day" title="${d.name}: ${d.n ? fmtSignedPct(d.sum) + ' · ' + tp(d.n, '{n} trade', '{n} trades') : t('sin trades')}">
      <div class="rc-val ${cls}">${d.n ? fmtSignedPct(d.sum) : ''}</div>
      <div class="rc-up">${d.sum > 0 ? `<div class="rc-bar pos" style="height:${h}%"></div>` : d.n && d.sum === 0 ? '<div class="rc-bar zero"></div>' : ''}</div>
      <div class="rc-down">${d.sum < 0 ? `<div class="rc-bar neg" style="height:${h}%"></div>` : ''}</div>
      <div class="rc-name">${d.name}${d.broke ? `<i class="rc-dot" title="${t('Rompiste el plan')}"></i>` : ''}</div>
    </div>`;
  }).join('');
}

// ---- Resumen automático ----
function renderReviewAuto(){
  const trades = Analytics.tradesOfWeek(reviewWeek);
  const auto = document.getElementById('reviewAuto');
  if(!trades.length){
    auto.innerHTML = `<div class="rv-empty-week">${Icons.svg('inbox', 22)}<span>${t('No registraste trades esta semana.')}</span></div>`;
    return;
  }
  const card = (tone, icon, label, body)=> `<div class="ra ra-${tone}"><span class="ra-ic">${Icons.svg(icon, 16)}</span><div><div class="ra-l">${label}</div><div class="ra-t">${body}</div></div></div>`;
  const out = [];
  const errs = Analytics.group(trades, h=> h.errors || []).sort((a, b)=> b.n - a.n);
  if(errs.length){
    const e = errorById(errs[0].key);
    out.push(card('bad', 'repeat', t('Error más repetido'), `<b>${e ? e.label : errs[0].key}</b> · ${tp(errs[0].n, '1 vez', '{n} veces')}`));
  } else out.push(card('good', 'check-check', t('Errores'), t('<b>No marcaste errores</b> esta semana')));
  const emos = Analytics.group(trades, h=> h.emotion).sort((a, b)=> b.n - a.n);
  if(emos.length){
    const e = emotionById(emos[0].key);
    out.push(card(e.tone === 'risk' ? 'warn' : 'good', e.tone === 'risk' ? 'frown' : 'smile', t('Emoción más frecuente'),
      `<b>${e.label}</b> · ${tp(emos[0].n, '{n} trade', '{n} trades')}, ${t('{avg} promedio', {avg: fmtSignedPct(emos[0].avg)})}`));
  }
  const broken = trades.filter(h=> !h.followedPlan);
  if(broken.length) out.push(card('warn', 'alert-triangle', t('Plan roto'),
    tp(broken.length, '<b>1 trade</b> fuera de plan · sumó {sum}', '<b>{n} trades</b> fuera de plan · sumaron {sum}', {sum: fmtSignedPct(broken.reduce((a, h)=> a + Analytics.pct(h), 0))})));
  else out.push(card('good', 'sparkles', t('Plan'), t('<b>Respetaste tu plan</b> en todos los trades')));
  const sorted = trades.slice().sort((a, b)=> Analytics.pct(b) - Analytics.pct(a));
  if(sorted.length >= 2){
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const lbl = h=> h.asset ? ' ' + t('en {asset}', {asset: escapeHtml(h.asset)}) : '';
    out.push(card('info', 'trending-up', t('Mejor y peor trade'),
      `<span class="pos">${fmtSignedPct(Analytics.pct(best))}</span>${lbl(best)} · <span class="neg">${fmtSignedPct(Analytics.pct(worst))}</span>${lbl(worst)}`));
  }
  auto.innerHTML = out.join('');
}

// ---- Trades de la semana ----
function renderReviewTrades(){
  const trades = Analytics.chronological(Analytics.tradesOfWeek(reviewWeek));
  document.getElementById('reviewTradesBox').style.display = trades.length ? '' : 'none';
  document.getElementById('reviewTradesTitle').textContent = tp(trades.length, 'Ver el trade de la semana', 'Ver los {n} trades de la semana');
  const box = document.getElementById('reviewTrades');
  box.innerHTML = trades.map(h=>{
    const d = keyDate(dayKeyFromTs(h.ts));
    const day = d.toLocaleDateString(LOCALE, {weekday: 'short', day: 'numeric'});
    const time = fmtTime(h.ts);
    const v = Analytics.pct(h);
    const emo = emotionById(h.emotion);
    const errs = (h.errors || []).map(id=> errorById(id)).filter(Boolean);
    return `<button type="button" class="rt" data-id="${h.id}">
      <span class="rt-when">${day}<small>${time}</small></span>
      <span class="rt-main">
        <span class="rt-top"><b>${h.asset ? escapeHtml(h.asset) : t('Trade')}</b>${h.direction ? `<span class="tp-dir ${h.direction}">${h.direction === 'long' ? 'Long' : 'Short'}</span>` : ''}${h.setup ? `<span class="rt-setup">${escapeHtml(h.setup)}</span>` : ''}</span>
        <span class="rt-tags">
          <span class="tag ${h.followedPlan ? 'good' : 'bad'}">${h.followedPlan ? t('En plan') : t('Fuera de plan')}</span>
          ${emo ? `<span class="tag">${emo.label}</span>` : ''}
          ${errs.map(e=> `<span class="tag bad">${e.label}</span>`).join('')}
        </span>
        ${h.note ? `<span class="rt-note">${escapeHtml(h.note)}</span>` : ''}
      </span>
      <span class="rt-res ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${fmtSignedPct(v)}</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.rt').forEach(b=> b.addEventListener('click', ()=> openTrade(b.dataset.id)));
}

// ---- Formulario ----
function renderQuestionChecks(){
  document.querySelectorAll('.rq').forEach(q=> q.classList.toggle('done', !!document.getElementById(q.dataset.q).value.trim()));
}

function renderReviewForm(){
  if(reviewDirty && reviewFormWeek === reviewWeek) return;
  // Al cambiar de semana, lo escrito y no guardado queda como borrador de esa semana.
  if(reviewDirty && reviewFormWeek) reviewDrafts[reviewFormWeek] = reviewFormValues();
  reviewFormWeek = reviewWeek;
  const draft = reviewDrafts[reviewWeek];
  reviewDirty = !!draft;
  const r = draft || state.reviews[reviewWeek] || {};
  document.getElementById('rvGood').value = r.good || '';
  document.getElementById('rvError').value = r.error || '';
  document.getElementById('rvChange').value = r.change || '';
  reviewScore = r.score || null;
  renderScore();
  renderQuestionChecks();
  document.getElementById('rvSave').textContent = state.reviews[reviewWeek] ? t('Actualizar revisión') : t('Guardar revisión');
  document.getElementById('rvSaved').textContent = draft ? t('Tenés cambios sin guardar en esta semana.') : state.reviews[reviewWeek] ? t('Guardada el {date}', {date: fmtDate(state.reviews[reviewWeek].savedAt)}) : '';
}

function renderScore(){
  const box = document.getElementById('rvScore');
  const tone = reviewScore ? scoreTone(reviewScore) : '';
  box.className = 'score-blocks ' + tone;
  box.innerHTML = Array.from({length: 10}, (_, i)=> `<button type="button" data-v="${i + 1}" class="${reviewScore && i < reviewScore ? 'on' : ''}" aria-label="${t('{n} de 10', {n: i + 1})}"><span>${i + 1}</span></button>`).join('');
  box.querySelectorAll('button').forEach(b=> b.addEventListener('click', ()=>{
    reviewScore = Number(b.dataset.v);
    reviewDirty = true;
    renderScore();
  }));
  const w = document.getElementById('rvScoreWord');
  w.className = 'rv-score-word ' + tone;
  w.textContent = reviewScore ? `${reviewScore}/10 · ${scoreWord(reviewScore)}` : '';
}

['rvGood', 'rvError', 'rvChange'].forEach(id=> document.getElementById(id).addEventListener('input', ()=>{
  reviewDirty = true;
  renderQuestionChecks();
}));

// ---- Historial ----
function renderReviewTrend(){
  const keys = Object.keys(state.reviews).filter(k=> state.reviews[k].score).sort().slice(-12);
  const box = document.getElementById('reviewTrend');
  if(keys.length < 2){ box.innerHTML = ''; return; }
  const W = 320, H = 90, P = 10;
  const x = i=> P + i * (W - 2 * P) / (keys.length - 1);
  const y = v=> H - P - (v - 1) / 9 * (H - 2 * P);
  const pts = keys.map((k, i)=> [x(i), y(state.reviews[k].score)]);
  const avg = keys.reduce((a, k)=> a + state.reviews[k].score, 0) / keys.length;
  box.innerHTML = `<div class="rv-trend">
    <div class="rv-trend-top"><span>${t('Nota de disciplina')}</span><span>${t('Promedio <b>{n}</b>', {n: avg.toFixed(1)})}</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="rv-trend-svg">
      <line x1="${P}" x2="${W - P}" y1="${y(7)}" y2="${y(7)}" class="rt-goal"/>
      <polyline points="${pts.map(p=> p.join(',')).join(' ')}" class="rt-line"/>
      ${pts.map((p, i)=> `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="rt-pt ${scoreTone(state.reviews[keys[i]].score)}"/>`).join('')}
    </svg>
    <div class="rv-trend-x"><span>${weekLabel(keys[0]).split(' – ')[0]}</span><span>${weekLabel(keys[keys.length - 1]).split(' – ')[0]}</span></div>
  </div>`;
}

function renderReviewList(){
  const keys = Object.keys(state.reviews).sort().reverse();
  const box = document.getElementById('reviewList');
  if(!keys.length){
    box.innerHTML = `<div class="rv-empty">
      <span class="rv-empty-ic">${Icons.svg('notebook-pen', 26)}</span>
      <b>${t('Todavía no hiciste ninguna revisión')}</b>
      <p>${t('Respondé las tres preguntas y calificá tu semana. Te lleva cinco minutos y es donde más se aprende.')}</p>
      <span class="rv-empty-badge">${Icons.svg('lightbulb', 14)} ${t('Desbloquea el logro "Autoconocimiento"')}</span>
    </div>`;
    return;
  }
  box.innerHTML = `<div class="rv-timeline">${keys.map(k=>{
    const r = state.reviews[k];
    const s = Analytics.summary(Analytics.tradesOfWeek(k));
    return `<button type="button" class="review-item ${k === reviewWeek ? 'current' : ''}" data-week="${k}">
      <span class="ri-score ${r.score ? scoreTone(r.score) : ''}">${r.score || '–'}</span>
      <span class="ri-body">
        <span class="review-item-top"><b>${weekLabel(k)}</b></span>
        <span class="review-item-sub">${tp(s.n, '{n} trade', '{n} trades')}${s.n ? ` · ${t('{n}% plan', {n: Math.round(s.planPct)})} · <span class="${s.sum > 0 ? 'pos' : s.sum < 0 ? 'neg' : ''}">${fmtSignedPct(s.sum)}</span>` : ''}</span>
        ${r.change ? `<span class="review-item-txt">${Icons.svg('target', 13)} ${escapeHtml(r.change)}</span>` : ''}
      </span>
    </button>`;
  }).join('')}</div>`;
  box.querySelectorAll('.review-item').forEach(b=> b.addEventListener('click', ()=>{
    reviewWeek = b.dataset.week;
    renderReview();
    window.scrollTo({top: 0, behavior: 'smooth'});
  }));
}

// ---- Aviso en Inicio ----
function renderReviewNudge(){
  const box = document.getElementById('homeReviewNudge');
  const key = weekToReviewToday();
  if(!key || state.reviews[key] || !Analytics.tradesOfWeek(key).length){ box.style.display = 'none'; return; }
  const n = Analytics.tradesOfWeek(key).length;
  box.style.display = '';
  box.innerHTML = `<span class="rn-ic">${Icons.svg('notebook-pen', 20)}</span>
    <div class="rn-txt"><b>${t('Es momento de revisar tu semana')}</b><span>${weekLabel(key)} · ${tp(n, '1 trade sin revisar. Te lleva cinco minutos.', '{n} trades sin revisar. Te lleva cinco minutos.')}</span></div>
    <button type="button" class="primary small" id="rnGo">${t('Revisar ahora')}</button>`;
  document.getElementById('rnGo').addEventListener('click', ()=>{
    reviewWeek = key;
    renderReview();
    showTab('review');
  });
}

function renderReview(){
  renderReviewHeader();
  renderReviewSummary();
  renderReviewChart();
  renderReviewAuto();
  renderReviewTrades();
  renderReviewForm();
  renderReviewTrend();
  renderReviewList();
}

document.getElementById('rvPrev').addEventListener('click', ()=>{ reviewWeek = shiftWeek(reviewWeek, -1); renderReview(); });
document.getElementById('rvNext').addEventListener('click', ()=>{ reviewWeek = shiftWeek(reviewWeek, 1); renderReview(); });

document.getElementById('rvSave').addEventListener('click', ()=>{
  const data = {
    good: document.getElementById('rvGood').value.trim(),
    error: document.getElementById('rvError').value.trim(),
    change: document.getElementById('rvChange').value.trim(),
    score: reviewScore,
  };
  if(!data.good && !data.error && !data.change && !data.score){
    document.getElementById('rvSaved').textContent = t('Respondé al menos una pregunta para guardar la revisión.');
    return;
  }
  state.reviews[reviewWeek] = {...data, savedAt: Date.now()};
  delete reviewDrafts[reviewWeek];
  reviewDirty = false;
  saveState();
  renderAll();
  document.getElementById('rvSaved').textContent = '✓ ' + t('Revisión guardada.');
});

// Los domingos y lunes, si la semana a revisar tuvo trades y no tiene revisión,
// la pestaña arranca en esa semana.
(function pickDefaultWeek(){
  const key = weekToReviewToday();
  if(key && Analytics.tradesOfWeek(key).length && !state.reviews[key]) reviewWeek = key;
})();

renderReview.tab = 'review';
onDataChange.push(renderReview);
onDataChange.push(renderReviewNudge);
renderOrDefer(renderReview);
renderReviewNudge();
