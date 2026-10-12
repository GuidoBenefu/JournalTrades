// Reglas que se verifican solas y registro de cambios del plan de cada trade.
//
// Una regla general puede tener `auto`: la app la tilda (o no) con los datos del
// trade y el usuario no la puede tocar en el formulario.
//   {type: 'hours', from: '09:30', to: '11:00'}  entrada dentro del horario (hora NY)
//   {type: 'maxTrades', max: 2}                    hasta N trades por día en la cuenta
//   {type: 'maxRisk', max: 0.5}                    riesgo del trade hasta N %
//
// Cada vez que cambia lo que se cumplió del plan en un trade ya guardado (porque
// se editó o porque la verificación automática cambió), queda una entrada en
// `trade.planEdits`: {at, by: 'user'|'auto', from, to, ticked, unticked}.

const AUTO_RULE_TYPES = [
  {id: '', label: t('La tildo yo en cada trade')},
  {id: 'hours', label: t('Automática: horario (hora NY)')},
  {id: 'maxTrades', label: t('Automática: máximo de trades por día')},
  {id: 'maxRisk', label: t('Automática: riesgo máximo por trade')},
];

const autoNum = v=>{
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? null : n;
};
const autoNumTxt = n=> String(Math.round(n * 100) / 100).replace('.', LANG === 'en' ? '.' : ',');

// Descripción corta de la verificación, para mostrar junto a la regla.
function autoRuleSummary(auto){
  if(!auto) return '';
  if(auto.type === 'hours') return t('Automática · de {from} a {to} hora NY', {from: auto.from, to: auto.to});
  if(auto.type === 'maxTrades') return t('Automática · hasta {n} por día', {n: auto.max});
  if(auto.type === 'maxRisk') return t('Automática · hasta {n}% por trade', {n: autoNumTxt(auto.max)});
  return '';
}

// Valida lo que se cargó en el editor. Devuelve {auto} o {error}.
function parseAutoRule(type, a, b){
  if(!type) return {auto: null};
  if(type === 'hours'){
    if(!HHMM.test(a || '') || !HHMM.test(b || '')) return {error: t('Elegí el horario de inicio y de fin (ej. 09:30 y 11:00).')};
    if(a === b) return {error: t('El horario de inicio y de fin no pueden ser iguales.')};
    return {auto: {type, from: a, to: b}};
  }
  const n = autoNum(a);
  if(type === 'maxTrades'){
    if(n === null || n < 1 || n > 100 || Math.round(n) !== n) return {error: t('El máximo de trades por día tiene que ser un número entero (ej. 2).')};
    return {auto: {type, max: n}};
  }
  if(type === 'maxRisk'){
    if(n === null || n <= 0 || n > 100) return {error: t('El riesgo máximo tiene que ser mayor a 0 y hasta 100 (ej. 0.5).')};
    return {auto: {type, max: n}};
  }
  return {auto: null};
}

// Campos para elegir cómo se verifica una regla. `cls` distingue cada editor en la página.
function autoRuleFieldsHtml(cls, auto){
  const type = auto ? auto.type : '';
  return `<div class="auto-rule ${cls}">
    <select class="ar-type" aria-label="${t('Cómo se verifica')}">
      ${AUTO_RULE_TYPES.map(o=> `<option value="${o.id}" ${o.id === type ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
    <span class="ar-params" data-for="hours" ${type === 'hours' ? '' : 'hidden'}>
      <input type="time" class="ar-from" value="${type === 'hours' ? auto.from : '09:30'}" aria-label="${t('Desde')}">
      <span>${t('a')}</span>
      <input type="time" class="ar-to" value="${type === 'hours' ? auto.to : '11:00'}" aria-label="${t('Hasta')}">
    </span>
    <span class="ar-params" data-for="maxTrades" ${type === 'maxTrades' ? '' : 'hidden'}>
      <input type="text" inputmode="numeric" class="ar-max-trades" value="${type === 'maxTrades' ? auto.max : ''}" placeholder="2" aria-label="${t('Máximo de trades por día')}">
      <span>${t('trades por día')}</span>
    </span>
    <span class="ar-params" data-for="maxRisk" ${type === 'maxRisk' ? '' : 'hidden'}>
      <input type="text" inputmode="decimal" class="ar-max-risk" value="${type === 'maxRisk' ? auto.max : ''}" placeholder="0.5" aria-label="${t('Riesgo máximo por trade')}">
      <span>%</span>
    </span>
  </div>`;
}

function bindAutoRuleFields(box){
  const sel = box.querySelector('.ar-type');
  sel.addEventListener('change', ()=>{
    box.querySelectorAll('.ar-params').forEach(p=> p.hidden = p.dataset.for !== sel.value);
  });
}

function readAutoRuleFields(box){
  const type = box.querySelector('.ar-type').value;
  if(type === 'hours') return parseAutoRule(type, box.querySelector('.ar-from').value, box.querySelector('.ar-to').value);
  if(type === 'maxTrades') return parseAutoRule(type, box.querySelector('.ar-max-trades').value);
  if(type === 'maxRisk') return parseAutoRule(type, box.querySelector('.ar-max-risk').value);
  return {auto: null};
}

function resetAutoRuleFields(box){
  box.querySelector('.ar-type').value = '';
  box.querySelector('.ar-max-trades').value = '';
  box.querySelector('.ar-max-risk').value = '';
  box.querySelectorAll('.ar-params').forEach(p=> p.hidden = true);
}

// Número del trade dentro de su día de trading en esa cuenta (1 = el primero).
function tradeNumberOfDay(ts, accountId, excludeId){
  const day = dayKeyFromTs(ts);
  return 1 + state.history.filter(h=> h.id !== excludeId && h.accountId === accountId
    && dayKeyFromTs(h.ts) === day && h.ts < ts).length;
}

// Resultado de una regla automática: {ok: true|false|null, text}. null = faltan datos.
function evalAutoRule(it, ctx){
  const a = it.auto;
  if(!a) return null;
  if(a.type === 'hours'){
    const p = nyParts(ctx.ts);
    const at = pad2(p.h) + ':' + pad2(p.min);
    // A diferencia de las sesiones, el horario de la regla incluye el minuto final:
    // "de 09:30 a 11:00" deja entrar a las 11:00.
    const min = p.h * 60 + p.min;
    const ok = inSession(min, {start: a.from, end: a.to}) || min === hhmmToMin(a.to);
    return {ok, text: ok ? t('Entraste a las {at} NY, dentro de tu horario ({from} a {to}).', {at, from: a.from, to: a.to})
      : t('Entraste a las {at} NY, fuera de tu horario ({from} a {to}).', {at, from: a.from, to: a.to})};
  }
  if(a.type === 'maxTrades'){
    const n = tradeNumberOfDay(ctx.ts, ctx.accountId, ctx.id);
    const ok = n <= a.max;
    return {ok, text: ok ? t('Trade {n} del día (tu máximo es {max}).', {n, max: a.max}) : t('Trade {n} del día: pasaste tu máximo de {max}.', {n, max: a.max})};
  }
  if(a.type === 'maxRisk'){
    if(ctx.riskPct === null || ctx.riskPct === undefined || Number.isNaN(ctx.riskPct)) return {ok: null, text: t('Cargá el riesgo del trade para verificarla.')};
    const ok = ctx.riskPct <= a.max + 1e-9;
    return {ok, text: ok ? t('Arriesgaste {r}% (tu máximo es {max}%).', {r: autoNumTxt(ctx.riskPct), max: autoNumTxt(a.max)})
      : t('Arriesgaste {r}%: más que tu máximo de {max}%.', {r: autoNumTxt(ctx.riskPct), max: autoNumTxt(a.max)})};
  }
  return null;
}

// Resultado de todas las reglas automáticas para un trade. {[itemId]: {ok, text}}
function evalAutoRules(ctx, items = state.items){
  const out = {};
  items.forEach(it=>{ const r = evalAutoRule(it, ctx); if(r) out[it.id] = r; });
  return out;
}

// ---- Registro de cambios ----
// Compara el plan de antes y el de después. Devuelve la entrada del registro, o null si no cambió nada.
function planEditEntry(before, after, by){
  const was = new Set(before.missingAll), now = new Set(after.missingAll);
  const auto = new Set(after.autoLabels);
  const nowOk = [...was].filter(l=> !now.has(l) && after.labels.includes(l));
  const nowMiss = [...now].filter(l=> !was.has(l));
  // Lo que cambió a mano y lo que cambió la verificación automática se guardan por separado.
  const ticked = nowOk.filter(l=> !auto.has(l)), unticked = nowMiss.filter(l=> !auto.has(l));
  const autoOk = nowOk.filter(l=> auto.has(l)), autoMiss = nowMiss.filter(l=> auto.has(l));
  if(before.followedPlan === after.followedPlan && !nowOk.length && !nowMiss.length) return null;
  return {at: Date.now(), by, from: !!before.followedPlan, to: !!after.followedPlan, ticked, unticked, autoOk, autoMiss};
}

function planSnapshot(h){
  return {followedPlan: !!h.followedPlan, missingAll: missedPlan(h), labels: state.items.map(it=> it.label).concat(h.criteria || []),
    autoLabels: state.items.filter(it=> it.auto).map(it=> it.label)};
}

function pushPlanEdit(h, entry){
  if(!entry) return;
  h.planEdits = (h.planEdits || []).concat(entry).slice(-50);
}

// Recalcula followedPlan y el puntaje de un trade a partir de lo que le falta.
function refreshPlanStatus(h){
  h.followedPlan = !(h.missing || []).length && !(h.criteriaMissing || []).length;
  const critTotal = (h.criteria || []).length;
  const total = (h.rulesTotal || 0) + critTotal;
  const done = Math.max(0, (h.rulesTotal || 0) - (h.missing || []).length) + critTotal - (h.criteriaMissing || []).length;
  h.score = disciplineScore(done, total, (h.errors || []).length, h.emotion, true);
}

// Al agregar, mover o borrar un trade cambia el número de trade del día de los demás:
// se vuelve a verificar la regla de máximo de trades en ese día y cuenta.
function refreshDayAutoRules(dayKey, accountId){
  const rules = state.items.filter(it=> it.auto && it.auto.type === 'maxTrades');
  if(!rules.length) return;
  state.history.filter(h=> h.accountId === accountId && dayKeyFromTs(h.ts) === dayKey && h.autoChecks).forEach(h=>{
    let changed = false;
    const before = planSnapshot(h);
    rules.forEach(it=>{
      if(!(it.id in h.autoChecks)) return;
      const r = evalAutoRule(it, {ts: h.ts, accountId: h.accountId, id: h.id});
      if(r.ok === h.autoChecks[it.id].ok) { h.autoChecks[it.id] = r; return; }
      h.autoChecks[it.id] = r;
      const ids = new Set(h.missingIds || []);
      const labels = (h.missing || []).filter(l=> l !== it.label);
      if(r.ok){ ids.delete(it.id); h.missing = labels; }
      else { ids.add(it.id); h.missing = labels.concat(it.label); }
      h.missingIds = [...ids];
      changed = true;
    });
    if(!changed) return;
    refreshPlanStatus(h);
    pushPlanEdit(h, planEditEntry(before, planSnapshot(h), 'auto'));
  });
}

// Texto del registro para el detalle del trade.
function planEditsHtml(h){
  const edits = h.planEdits || [];
  if(!edits.length) return '';
  const st = v=> v ? t('Plan seguido') : t('Plan roto');
  const list = edits.slice().reverse().map(e=>{
    const when = fmtDate(e.at) + ' ' + fmtTime(e.at);
    const who = e.by === 'auto' ? t('Verificación automática') : t('Lo editaste');
    const change = e.from !== e.to ? `<b class="${e.to ? 'pos' : 'neg'}">${st(e.from)} → ${st(e.to)}</b>` : `<span class="tp-muted">${st(e.to)}</span>`;
    const parts = [];
    if(e.ticked.length) parts.push(t('Tildaste después: {list}', {list: e.ticked.map(escapeHtml).join(', ')}));
    if(e.unticked.length) parts.push(t('Destildaste: {list}', {list: e.unticked.map(escapeHtml).join(', ')}));
    if((e.autoOk || []).length) parts.push(t('Ahora se cumple: {list}', {list: e.autoOk.map(escapeHtml).join(', ')}));
    if((e.autoMiss || []).length) parts.push(t('Ahora no se cumple: {list}', {list: e.autoMiss.map(escapeHtml).join(', ')}));
    return `<li><div class="pe-top"><span>${who} · ${when}</span>${change}</div>${parts.length ? `<div class="pe-d">${parts.join(' · ')}</div>` : ''}</li>`;
  }).join('');
  const toFollowed = edits.filter(e=> e.by === 'user' && !e.from && e.to).length;
  return `<ul class="plan-edits">${list}</ul>${toFollowed ? `<p class="pe-warn">${Icons.svg('alert-triangle', 14)} ${t('Este trade se registró como plan roto y después se cambió a plan seguido.')}</p>` : ''}`;
}

// Trades donde el plan se cambió de roto a seguido editándolo después.
const planFlippedByUser = h=> (h.planEdits || []).some(e=> e.by === 'user' && !e.from && e.to);
