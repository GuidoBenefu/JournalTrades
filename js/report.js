// Reporte mensual en PDF. Se arma un documento pensado para imprimir dentro de
// #printReport y se abre el diálogo de impresión: ahí se elige "Guardar como
// PDF" (también en el celular). No usa librerías y funciona sin conexión.
// Respeta la cuenta elegida en el selector de cuentas.

function rpSvgCurve(list){
  const real = [0], plan = [0];
  let a = 0, b = 0;
  list.forEach(h=>{ a += Analytics.pct(h); if(h.followedPlan) b += Analytics.pct(h); real.push(a); plan.push(b); });
  const W = 700, H = 200, P = 28;
  const all = real.concat(plan);
  const min = Math.min(...all, 0), max = Math.max(...all, 0.5);
  const x = i=> P + i * (W - 2 * P) / Math.max(1, real.length - 1);
  const y = v=> P + (max - v) * (H - 2 * P) / (max - min || 1);
  const pts = arr=> arr.map((v, i)=> x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="rp-svg" preserveAspectRatio="none">
    <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" class="rp-zero"/>
    <polyline points="${pts(plan)}" class="rp-plan"/>
    <polyline points="${pts(real)}" class="rp-real"/>
    <text x="${P}" y="${y(max) - 8}" class="rp-axis">${fmtSignedPct(max)}</text>
    <text x="${P}" y="${y(min) + 18}" class="rp-axis">${fmtSignedPct(min)}</text>
  </svg>
  <div class="rp-legend"><span class="rp-l-real">${t('Resultado real')}</span><span class="rp-l-plan">${t('Si hubieras seguido tu plan')}</span></div>`;
}

function rpCalendar(monthKey, list){
  const [y, m] = monthKey.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const by = {};
  list.forEach(h=>{ const k = dayKeyFromTs(h.ts); (by[k] = by[k] || []).push(h); });
  let cells = WEEKDAYS.map(d=> `<div class="rp-dow">${d}</div>`).join('');
  for(let i = 0; i < offset; i++) cells += '<div class="rp-day out"></div>';
  for(let d = 1; d <= days; d++){
    const k = monthKey + '-' + String(d).padStart(2, '0');
    const tr = by[k] || [];
    const sum = tr.reduce((a, h)=> a + Analytics.pct(h), 0);
    const broke = tr.some(h=> !h.followedPlan);
    cells += `<div class="rp-day ${tr.length ? (sum > 0.05 ? 'pos' : sum < -0.05 ? 'neg' : 'be') : ''}">
      <span class="rp-dn">${d}</span>${tr.length ? `<b>${fmtSignedPct(sum)}</b><small>${tp(tr.length, '{n} trade', '{n} trades')}${broke ? ' · ✗' : ''}</small>` : ''}</div>`;
  }
  return `<div class="rp-cal">${cells}</div>`;
}

function rpTable(title, rows, nameFn){
  if(!rows.length) return '';
  return `<div class="rp-block"><h3>${title}</h3><table class="rp-table">
    <thead><tr><th></th><th>${t('Trades')}</th><th>${t('Win rate')}</th><th>${t('Plan seguido')}</th><th>${t('Prom./trade')}</th><th>${t('Total')}</th></tr></thead>
    <tbody>${rows.sort((a, b)=> b.n - a.n).map(r=> `<tr><td>${nameFn(r.key)}</td><td>${r.n}</td><td>${Math.round(r.winRate)}%</td><td>${Math.round(r.planPct)}%</td>
      <td class="${signClass(r.avg)}">${fmtSignedPct(r.avg)}</td><td class="${signClass(r.sum)}">${fmtSignedPct(r.sum)}</td></tr>`).join('')}</tbody></table></div>`;
}

function buildMonthReport(monthKey){
  const list = Analytics.chronological(viewTrades().filter(h=> monthKeyOf(h.ts) === monthKey));
  const s = setupStats(list);
  const goal = goalPct();
  const monthName = capFirst(keyDate(monthKey + '-15').toLocaleDateString(LOCALE, {month: 'long', year: 'numeric'}));
  const acc = state.viewAccount === 'all' ? (state.accounts.length > 1 ? t('Todas las cuentas') : state.accounts[0].name) : (accountById(state.viewAccount) || {}).name;
  const user = JournalAuth.currentUser();
  const days = new Set(list.map(h=> dayKeyFromTs(h.ts)));
  const kpi = (l, v, cls = '')=> `<div class="rp-kpi"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  const dayList = [...days].map(k=> [k, list.filter(h=> dayKeyFromTs(h.ts) === k).reduce((a, h)=> a + Analytics.pct(h), 0)]).sort((a, b)=> b[1] - a[1]);
  const fmtDay = k=> keyDate(k).toLocaleDateString(LOCALE, {weekday: 'short', day: 'numeric'});
  const insights = Analytics.insights(list).slice(0, 6);
  const errs = Analytics.group(list, h=> h.errors || []).sort((a, b)=> b.n - a.n);
  // Revisiones de las semanas que tocan el mes.
  const weeks = [...new Set(list.map(h=> Analytics.weekKey(h.ts)))].sort().filter(k=> state.reviews[k]);
  const dir = d=> d === 'long' ? t('Long') : d === 'short' ? t('Short') : '';

  return `<div class="rp">
    <header class="rp-head">
      <img src="img/logo.png" alt="Journal Trading" class="rp-logo">
      <div class="rp-head-t">
        <div class="rp-kicker">${t('Reporte mensual')}</div>
        <h1>${monthName}</h1>
        <div class="rp-sub">${escapeHtml(acc || '')}${user ? ' · ' + escapeHtml(user.name) : ''} · ${t('Generado el {date}', {date: fmtDate(Date.now())})}</div>
      </div>
    </header>

    ${list.length ? `
    <section class="rp-kpis">
      ${kpi(t('Resultado'), fmtSignedPct(s.sum), signClass(s.sum))}
      ${kpi(t('Trades'), s.n)}
      ${kpi(t('Win rate'), Math.round(s.winRate) + '%')}
      ${kpi(t('Plan seguido'), Math.round(s.planPct) + '% <small>' + t('meta {goal}%', {goal}) + '</small>', s.planPct >= goal ? 'pos' : 'warn')}
      ${kpi(t('Prom./trade'), fmtSignedPct(s.avg), signClass(s.avg))}
      ${kpi(t('R promedio'), fmtR(s.avgR), s.avgR === null ? '' : signClass(s.avgR))}
      ${kpi(t('Profit factor'), fmtPf(s.pf))}
      ${kpi(t('Días operados'), days.size)}
    </section>
    <p class="rp-line">${t('Mejor día')}: <b class="pos">${fmtDay(dayList[0][0])} ${fmtSignedPct(dayList[0][1])}</b> · ${t('Peor día')}: <b class="${signClass(dayList[dayList.length - 1][1])}">${fmtDay(dayList[dayList.length - 1][0])} ${fmtSignedPct(dayList[dayList.length - 1][1])}</b>
      · ${t('Con tu plan habrías hecho {plan}', {plan: fmtSignedPct(list.filter(h=> h.followedPlan).reduce((a, h)=> a + Analytics.pct(h), 0))})}</p>

    <div class="rp-block"><h3>${t('Curva de resultados')}</h3>${rpSvgCurve(list)}</div>
    <div class="rp-block"><h3>${t('Calendario')}</h3>${rpCalendar(monthKey, list)}</div>
    ${insights.length ? `<div class="rp-block"><h3>${t('Lo que dicen tus datos')}</h3><ul class="rp-ins">${insights.map(i=> `<li class="${i.tone}">${i.text}</li>`).join('')}</ul></div>` : ''}
    ${rpTable(t('Por setup'), Analytics.group(list, h=> h.setup ? h.setup.trim() : null), k=> escapeHtml(k))}
    ${rpTable(t('Por sesión'), Analytics.group(list, h=> sessionOf(h.ts)), k=> escapeHtml(k))}
    ${rpTable(t('Por emoción'), Analytics.group(list, h=> h.emotion), k=>{ const e = emotionById(k); return e ? e.label : k; })}
    ${errs.length ? `<div class="rp-block"><h3>${t('Errores')}</h3><table class="rp-table"><thead><tr><th></th><th>${t('Veces')}</th><th>${t('Prom./trade')}</th></tr></thead>
      <tbody>${errs.map(r=>{ const e = errorById(r.key); return `<tr><td>${e ? e.label : r.key}</td><td>${r.n}</td><td class="${signClass(r.avg)}">${fmtSignedPct(r.avg)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
    ${weeks.length ? `<div class="rp-block"><h3>${t('Revisiones semanales')}</h3>${weeks.map(k=>{ const r = state.reviews[k]; return `<div class="rp-rev">
      <div class="rp-rev-h"><b>${weekLabel(k)}</b>${r.score ? `<span>${t('Disciplina {n}/10', {n: r.score})}</span>` : ''}</div>
      ${r.good ? `<p><b>${t('Lo que hiciste bien')}:</b> ${escapeHtml(r.good)}</p>` : ''}
      ${r.error ? `<p><b>${t('El error que se repitió')}:</b> ${escapeHtml(r.error)}</p>` : ''}
      ${r.change ? `<p><b>${t('Qué vas a cambiar')}:</b> ${escapeHtml(r.change)}</p>` : ''}</div>`; }).join('')}</div>` : ''}
    <div class="rp-block rp-trades"><h3>${t('Trades del mes')}</h3><table class="rp-table rp-small">
      <thead><tr><th>${t('Fecha')}</th><th>${t('Hora (NY)')}</th><th>${t('Activo')}</th><th>${t('Dirección')}</th><th>${t('Setup')}</th><th>${t('Resultado')}</th><th>R</th><th>${t('Plan')}</th><th>${t('Emoción')}</th></tr></thead>
      <tbody>${list.map(h=>{ const r = realR(h), e = emotionById(h.emotion); return `<tr>
        <td>${fmtDate(h.ts)}</td><td>${fmtTime(h.ts, NY_TZ)}</td><td>${escapeHtml(h.asset || '')}</td><td>${dir(h.direction)}</td><td>${escapeHtml(h.setup || '')}</td>
        <td class="${signClass(Analytics.pct(h))}">${h.resultPct === null || h.resultPct === undefined ? RESULT_LABELS[h.result] || '' : fmtSignedPct(h.resultPct)}</td>
        <td>${r === null ? '' : (r > 0 ? '+' : '') + r.toFixed(1)}</td><td class="${h.followedPlan ? 'pos' : 'neg'}">${h.followedPlan ? '✓' : '✗'}</td><td>${e ? e.label : ''}</td></tr>`; }).join('')}</tbody></table></div>
    ` : `<p class="rp-empty">${t('No hay trades en este mes.')}</p>`}
    <footer class="rp-foot">Journal Trading · ${t('Operá con un plan. Ejecutá con disciplina.')}</footer>
  </div>`;
}

function printMonthReport(monthKey){
  const box = document.getElementById('printReport');
  box.innerHTML = buildMonthReport(monthKey);
  const prevTitle = document.title;
  // El nombre del archivo PDF sale del título de la página.
  document.title = `Journal Trading - ${t('Reporte')} ${monthKey}`;
  const done = ()=>{ document.title = prevTitle; box.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Se espera a que cargue el logo para que salga en el PDF.
  const img = box.querySelector('img');
  const go = ()=> setTimeout(()=> window.print(), 50);
  if(img && !img.complete){ img.onload = go; img.onerror = go; } else go();
}

document.addEventListener('click', e=>{
  const b = e.target.closest('[data-report-month]');
  if(b) printMonthReport(b.dataset.reportMonth);
});
