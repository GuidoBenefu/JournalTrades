// Pestaña Revisión: resumen automático de la semana y preguntas guiadas.
// Las respuestas se guardan en state.reviews por semana (clave = lunes).

let reviewWeek = Analytics.weekKey(Date.now());
let reviewScore = null;

function weekLabel(key){
  const start = new Date(key + 'T00:00:00');
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const f = d=> d.toLocaleDateString('es-AR', {day: 'numeric', month: 'short'});
  return `${f(start)} – ${f(end)}`;
}

function weekOptions(){
  const keys = new Set([Analytics.weekKey(Date.now())]);
  state.history.forEach(h=> keys.add(Analytics.weekKey(h.ts)));
  Object.keys(state.reviews).forEach(k=> keys.add(k));
  return [...keys].sort().reverse().slice(0, 26);
}

function renderReviewWeekSelect(){
  const thisWeek = Analytics.weekKey(Date.now());
  document.getElementById('reviewWeek').innerHTML = weekOptions().map(k=>
    `<option value="${k}" ${k === reviewWeek ? 'selected' : ''}>${k === thisWeek ? 'Esta semana' : weekLabel(k)}${state.reviews[k] ? ' ✓' : ''}</option>`).join('');
}

function renderReviewSummary(){
  const trades = Analytics.tradesOfWeek(reviewWeek);
  const s = Analytics.summary(trades);
  const stat = (n, l)=> `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  document.getElementById('reviewTitle').textContent = 'Tu semana · ' + weekLabel(reviewWeek);
  document.getElementById('reviewSummary').innerHTML = [
    stat(s.n, 'Trades'),
    stat(s.n ? Math.round(s.planPct) + '%' : '—', 'Siguió el plan'),
    stat(s.n ? fmtSignedPct(s.sum) : '—', 'Resultado'),
    stat(s.n ? Math.round(s.winRate) + '%' : '—', 'Win rate'),
  ].join('');

  const auto = document.getElementById('reviewAuto');
  if(!trades.length){
    auto.innerHTML = '<div class="empty" style="margin-top:12px;">No registraste trades esta semana.</div>';
    return;
  }
  const lines = [];
  const errs = Analytics.group(trades, h=> h.errors || []).sort((a, b)=> b.n - a.n);
  if(errs.length){
    const e = errorById(errs[0].key);
    lines.push(`<li>🔁 Error más repetido: <b>${e ? e.label : errs[0].key}</b> (${errs[0].n} ${errs[0].n === 1 ? 'vez' : 'veces'}).</li>`);
  } else lines.push('<li>🧼 No marcaste errores esta semana.</li>');
  const emos = Analytics.group(trades, h=> h.emotion).sort((a, b)=> b.n - a.n);
  if(emos.length){
    const e = emotionById(emos[0].key);
    lines.push(`<li>${e.ic} Emoción más frecuente: <b>${emotionWord(e)}</b> (${emos[0].n} ${emos[0].n === 1 ? 'trade' : 'trades'}, ${fmtSignedPct(emos[0].avg)} promedio).</li>`);
  }
  const broken = trades.filter(h=> !h.followedPlan);
  if(broken.length) lines.push(`<li>📐 Rompiste el plan en ${broken.length} ${broken.length === 1 ? 'trade' : 'trades'}, que sumaron ${fmtSignedPct(broken.reduce((a, h)=> a + Analytics.pct(h), 0))}.</li>`);
  else lines.push('<li>✨ Respetaste tu plan en todos los trades de la semana.</li>');
  const sorted = trades.slice().sort((a, b)=> Analytics.pct(b) - Analytics.pct(a));
  if(sorted.length >= 2){
    const best = sorted[0], worst = sorted[sorted.length - 1];
    lines.push(`<li>📈 Mejor trade: ${fmtSignedPct(Analytics.pct(best))}${best.asset ? ' en ' + escapeHtml(best.asset) : ''} · Peor: ${fmtSignedPct(Analytics.pct(worst))}${worst.asset ? ' en ' + escapeHtml(worst.asset) : ''}.</li>`);
  }
  auto.innerHTML = `<ul class="review-auto">${lines.join('')}</ul>`;
}

function renderReviewForm(){
  const r = state.reviews[reviewWeek] || {};
  document.getElementById('rvGood').value = r.good || '';
  document.getElementById('rvError').value = r.error || '';
  document.getElementById('rvChange').value = r.change || '';
  reviewScore = r.score || null;
  renderScore();
  document.getElementById('rvSave').textContent = state.reviews[reviewWeek] ? 'Actualizar revisión' : 'Guardar revisión';
  document.getElementById('rvSaved').textContent = state.reviews[reviewWeek] ? 'Guardada el ' + fmtDate(state.reviews[reviewWeek].savedAt) : '';
}

function renderScore(){
  const box = document.getElementById('rvScore');
  box.innerHTML = Array.from({length: 10}, (_, i)=> `<button type="button" data-v="${i + 1}" class="${reviewScore === i + 1 ? 'active' : ''}">${i + 1}</button>`).join('');
  box.querySelectorAll('button').forEach(b=> b.addEventListener('click', ()=>{
    reviewScore = Number(b.dataset.v);
    renderScore();
  }));
}

function renderReviewList(){
  const keys = Object.keys(state.reviews).sort().reverse();
  const box = document.getElementById('reviewList');
  if(!keys.length){
    box.innerHTML = '<div class="empty">Todavía no guardaste revisiones. La primera desbloquea un logro.</div>';
    return;
  }
  box.innerHTML = keys.map(k=>{
    const r = state.reviews[k];
    const s = Analytics.summary(Analytics.tradesOfWeek(k));
    return `<button type="button" class="review-item" data-week="${k}">
      <div class="review-item-top"><b>${weekLabel(k)}</b>${r.score ? `<span class="review-score">${r.score}/10</span>` : ''}</div>
      <div class="review-item-sub">${s.n} trades · ${s.n ? Math.round(s.planPct) + '% plan · ' + fmtSignedPct(s.sum) : 'sin trades'}</div>
      ${r.change ? `<div class="review-item-txt">→ ${escapeHtml(r.change)}</div>` : ''}
    </button>`;
  }).join('');
  box.querySelectorAll('.review-item').forEach(b=> b.addEventListener('click', ()=>{
    reviewWeek = b.dataset.week;
    renderReview();
    window.scrollTo({top: 0, behavior: 'smooth'});
  }));
}

function renderReview(){
  renderReviewWeekSelect();
  renderReviewSummary();
  renderReviewForm();
  renderReviewList();
}

document.getElementById('reviewWeek').addEventListener('change', e=>{
  reviewWeek = e.target.value;
  renderReview();
});

document.getElementById('rvSave').addEventListener('click', ()=>{
  const data = {
    good: document.getElementById('rvGood').value.trim(),
    error: document.getElementById('rvError').value.trim(),
    change: document.getElementById('rvChange').value.trim(),
    score: reviewScore,
  };
  if(!data.good && !data.error && !data.change && !data.score){
    document.getElementById('rvSaved').textContent = 'Respondé al menos una pregunta para guardar la revisión.';
    return;
  }
  state.reviews[reviewWeek] = {...data, savedAt: Date.now()};
  saveState();
  renderAll();
  document.getElementById('rvSaved').textContent = '✓ Revisión guardada.';
});

// Los domingos y lunes, si la semana anterior tuvo trades y no tiene revisión,
// la pestaña arranca en esa semana.
(function pickDefaultWeek(){
  const day = new Date().getDay();
  if(day !== 0 && day !== 1) return;
  const prev = Analytics.weekKey(Date.now() - 7 * 86400000);
  if(day === 1 && Analytics.tradesOfWeek(prev).length && !state.reviews[prev]) reviewWeek = prev;
})();

onDataChange.push(renderReview);
renderReview();
