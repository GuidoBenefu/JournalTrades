// Setups del Trading Plan (pestaña Plan): la ficha de cada setup (descripción,
// criterios de entrada y una captura de ejemplo) y sus números reales. Un trade
// pertenece a un setup por el nombre que se carga en el campo Setup, así los
// trades viejos quedan vinculados solos. Los criterios se tildan en el formulario
// junto con las reglas generales y cuentan para "Plan respetado".
//
// state.playbook: [{id, name, description, criteria: [texto], imageId | image,
//                   createdAt, archived}]

const setupKey = s=> String(s || '').trim().toLowerCase();
function playbookSetups(includeArchived){
  return state.playbook.filter(p=> includeArchived || !p.archived);
}
function setupByName(name){
  const k = setupKey(name);
  return k ? state.playbook.find(p=> setupKey(p.name) === k) || null : null;
}
function setupTrades(p){
  const k = setupKey(p.name);
  return viewTrades().filter(h=> setupKey(h.setup) === k);
}
const setupImage = p=> (p && (ImageStore.get(p.imageId) || p.image)) || null;

// Números de un setup: además del resumen de siempre, R promedio, profit factor
// y el resultado de los trades con el plan respetado.
function setupStats(list){
  const s = Analytics.summary(list);
  const withPct = list.filter(h=> h.resultPct !== null && h.resultPct !== undefined);
  const gains = withPct.filter(h=> h.resultPct > 0).reduce((a, h)=> a + h.resultPct, 0);
  const losses = -withPct.filter(h=> h.resultPct < 0).reduce((a, h)=> a + h.resultPct, 0);
  const rs = list.map(realR).filter(r=> r !== null);
  const inPlan = Analytics.summary(list.filter(h=> h.followedPlan));
  return {...s, avgR: rs.length ? rs.reduce((a, b)=> a + b, 0) / rs.length : null,
    pf: losses > 0 ? gains / losses : gains > 0 ? Infinity : null, planAvg: inPlan.n ? inPlan.avg : null};
}
const fmtPf = v=> v === null ? '—' : v === Infinity ? '∞' : v.toFixed(2);
const fmtR = v=> v === null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + 'R';

// ---------- Pestaña ----------

function renderPlaybook(){
  const list = playbookSetups(false);
  const stats = new Map(list.map(p=> [p.id, setupStats(setupTrades(p))]));
  // El mejor setup: el de mayor promedio por trade, con al menos 3 trades y en positivo.
  const ranked = list.filter(p=> stats.get(p.id).n >= MIN_SAMPLE).sort((a, b)=> stats.get(b.id).avg - stats.get(a.id).avg);
  const best = ranked.length >= 2 && stats.get(ranked[0].id).avg > 0 ? ranked[0].id : null;
  const worst = ranked.length >= 2 && stats.get(ranked[ranked.length - 1].id).avg < 0 ? ranked[ranked.length - 1].id : null;

  const grid = document.getElementById('pbGrid');
  grid.innerHTML = list.length ? list.map(p=>{
    const s = stats.get(p.id), img = setupImage(p);
    const tag = p.id === best ? `<span class="tag good">${t('Mejor setup')}</span>` : p.id === worst ? `<span class="tag bad">${t('Te cuesta plata')}</span>` : '';
    return `<button type="button" class="pb-card" data-pb="${p.id}">
      <div class="pb-img ${img ? '' : 'empty'}">${img ? `<img src="${img}" alt="">` : Icons.svg('image', 26)}</div>
      <div class="pb-body">
        <div class="pb-top"><b>${escapeHtml(p.name)}</b>${tag}</div>
        ${p.description ? `<p class="pb-desc">${escapeHtml(p.description)}</p>` : ''}
        <div class="pb-meta">${tp(p.criteria.length, '{n} criterio', '{n} criterios')}</div>
        <div class="pb-stats">
          <div><span>${t('Trades')}</span><b>${s.n}</b></div>
          <div><span>${t('Win rate')}</span><b>${s.n ? Math.round(s.winRate) + '%' : '—'}</b></div>
          <div><span>${t('Prom./trade')}</span><b class="${s.n ? signClass(s.avg) : ''}">${s.n ? fmtSignedPct(s.avg) : '—'}</b></div>
          <div><span>${t('Plan seguido')}</span><b>${s.n ? Math.round(s.planPct) + '%' : '—'}</b></div>
        </div>
      </div>
    </button>`;
  }).join('') : `<div class="pb-empty">
      <span class="pb-empty-ic">${Icons.svg('book', 28)}</span>
      <b>${t('Armá tu Playbook')}</b>
      <p>${t('Cada setup que operás, con sus criterios y una captura de ejemplo. Así ves cuál te da plata y cuál no, y lo repasás antes de entrar.')}</p>
    </div>`;
  grid.querySelectorAll('[data-pb]').forEach(b=> b.addEventListener('click', ()=> openSetup(b.dataset.pb)));

  // Setups que aparecen en los trades pero todavía no tienen ficha.
  const counts = {};
  viewTrades().forEach(h=>{
    const k = setupKey(h.setup);
    if(!k || setupByName(h.setup)) return;
    if(!counts[k]) counts[k] = {name: h.setup.trim(), n: 0};
    counts[k].n++;
  });
  const loose = Object.values(counts).sort((a, b)=> b.n - a.n);
  const box = document.getElementById('pbLoose');
  box.style.display = loose.length ? '' : 'none';
  box.innerHTML = loose.length ? `<div class="set-sub">${t('Setups sin ficha')}</div>
    <p class="pb-loose-p">${t('Los cargaste en tus trades pero todavía no están en tu Playbook.')}</p>
    <div class="pb-loose">${loose.map(l=> `<button type="button" class="chip" data-new-setup="${escapeHtml(l.name)}">${Icons.svg('plus', 13)} ${escapeHtml(l.name)} <small>${tp(l.n, '{n} trade', '{n} trades')}</small></button>`).join('')}</div>` : '';
  box.querySelectorAll('[data-new-setup]').forEach(b=> b.addEventListener('click', ()=> openSetupEditor(null, b.dataset.newSetup)));

  const archived = state.playbook.filter(p=> p.archived);
  const arch = document.getElementById('pbArchived');
  arch.style.display = archived.length ? '' : 'none';
  arch.innerHTML = archived.length ? `<details><summary>${tp(archived.length, '1 setup archivado', '{n} setups archivados')}</summary>
    <div class="pb-arch-list">${archived.map(p=> `<button type="button" class="chip" data-pb="${p.id}">${escapeHtml(p.name)}</button>`).join('')}</div></details>` : '';
  arch.querySelectorAll('[data-pb]').forEach(b=> b.addEventListener('click', ()=> openSetup(b.dataset.pb)));
}

// ---------- Detalle ----------

// Cada criterio con cuántas veces lo cumpliste (solo trades donde se tildó ese criterio).
function criteriaStats(p, trades){
  return `<div class="crit-stats">${p.criteria.map(c=>{
    const list = trades.filter(h=> (h.criteria || []).includes(c));
    const ok = list.filter(h=> !(h.criteriaMissing || []).includes(c)).length;
    const pct = list.length ? Math.round(ok / list.length * 100) : null;
    return `<div class="itemstat ${pct === null ? '' : pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad'}">
      <div class="top"><span>${escapeHtml(c)}</span><span>${pct === null ? '—' : `<b>${pct}%</b> · ${ok}/${list.length}`}</span></div>
      <div class="bar"><div class="fill" style="width:${pct || 0}%"></div></div></div>`;
  }).join('')}</div>`;
}

let openSetupId = null;
function openSetup(id){
  openSetupId = id;
  renderSetupPanel();
  const panel = document.getElementById('setupPanel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}
function closeSetup(){
  openSetupId = null;
  const panel = document.getElementById('setupPanel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
}

function renderSetupPanel(){
  const p = state.playbook.find(x=> x.id === openSetupId);
  if(!p){ closeSetup(); return; }
  const trades = Analytics.chronological(setupTrades(p));
  const s = setupStats(trades);
  const img = setupImage(p);
  document.getElementById('spKicker').textContent = p.archived ? t('Setup archivado') : t('Setup');
  document.getElementById('spTitle').textContent = p.name;
  const cell = (l, v, cls = '')=> `<div><span class="ds-v ${cls}">${v}</span><span class="ds-l">${l}</span></div>`;
  document.getElementById('spBody').innerHTML = `
    ${img ? `<img class="tp-img" src="${img}" alt="${t('Ejemplo del setup')}">` : ''}
    ${p.description ? `<p class="sp-desc">${escapeHtml(p.description).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="tp-sec"><div class="tp-sec-t">${t('Criterios para entrar')} <small class="tp-muted">${t('· cuántas veces los cumpliste')}</small></div>
      ${p.criteria.length ? criteriaStats(p, trades) : `<p class="tp-muted">${t('Todavía no cargaste criterios.')}</p>`}
    </div>
    <div class="tp-sec"><div class="tp-sec-t">${t('Tus números con este setup')}</div>
      ${s.n ? `<div class="day-summary sp-stats">
        ${cell(t('Trades'), s.n)}
        ${cell(t('Win rate'), Math.round(s.winRate) + '%')}
        ${cell(t('Prom./trade'), fmtSignedPct(s.avg), signClass(s.avg))}
        ${cell(t('Total'), fmtSignedPct(s.sum), signClass(s.sum))}
        ${cell(t('R promedio'), fmtR(s.avgR), s.avgR === null ? '' : signClass(s.avgR))}
        ${cell(t('Profit factor'), fmtPf(s.pf))}
        ${cell(t('Plan seguido'), Math.round(s.planPct) + '%')}
        ${cell(t('Prom. con plan'), s.planAvg === null ? '—' : fmtSignedPct(s.planAvg), s.planAvg === null ? '' : signClass(s.planAvg))}
      </div>
      <div class="sp-chart" id="spChart"></div>` : `<p class="tp-muted">${t('Todavía no hay trades con este setup. Cuando cargues uno, escribí "{name}" en el campo Setup.', {name: escapeHtml(p.name)})}</p>`}
    </div>
    ${trades.length ? `<div class="tp-sec"><div class="tp-sec-t">${t('Últimos trades')}</div>
      <div class="hist">${trades.slice(-5).reverse().map(h=> tradeRow(h, true)).join('')}</div></div>` : ''}`;
  const pic = document.querySelector('#spBody .tp-img');
  if(pic) pic.addEventListener('click', ()=> openLightbox(img));
  document.querySelectorAll('#spBody .hx-row').forEach(r=> r.addEventListener('click', ()=>{ closeSetup(); openTrade(r.dataset.id); }));
  if(trades.length) requestAnimationFrame(()=> equityChart(document.getElementById('spChart'), 160, trades));
  document.getElementById('spFoot').innerHTML = `
    <button type="button" class="ghost" id="spArchive">${p.archived ? t('Reactivar') : t('Archivar')}</button>
    <button type="button" class="primary" id="spEdit">${Icons.svg('pencil', 15)} ${t('Editar setup')}</button>`;
  document.getElementById('spEdit').addEventListener('click', ()=>{ closeSetup(); openSetupEditor(p.id); });
  document.getElementById('spArchive').addEventListener('click', ()=>{
    p.archived = !p.archived;
    saveState();
    renderAll();
    renderSetupPanel();
  });
}
document.querySelectorAll('[data-close-setup]').forEach(el=> el.addEventListener('click', closeSetup));
document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && openSetupId) closeSetup(); });

// ---------- Editor ----------

let pbDraft = null;
function openSetupEditor(id, presetName){
  const p = id ? state.playbook.find(x=> x.id === id) : null;
  pbDraft = p ? {...p, criteria: p.criteria.slice(), img: setupImage(p)} : {id: null, name: presetName || '', description: '', criteria: [], img: null, archived: false};
  document.getElementById('pbEdTitle').textContent = p ? t('Editar setup') : t('Nuevo setup');
  document.getElementById('pbName').value = pbDraft.name;
  document.getElementById('pbDesc').value = pbDraft.description;
  document.getElementById('pbNewCrit').value = '';
  document.getElementById('pbError').textContent = '';
  document.getElementById('pbDelete').style.display = p ? '' : 'none';
  renderEditorCriteria();
  renderEditorImage();
  document.getElementById('pbEditor').style.display = 'flex';
  document.getElementById(pbDraft.name ? 'pbDesc' : 'pbName').focus();
}
function closeSetupEditor(){
  document.getElementById('pbEditor').style.display = 'none';
  pbDraft = null;
}
function renderEditorCriteria(){
  const box = document.getElementById('pbCrit');
  box.innerHTML = pbDraft.criteria.length ? pbDraft.criteria.map((c, i)=> `<div class="ob-item">
      <span class="ob-num">${i + 1}</span>
      <div class="ob-text"><span class="t">${escapeHtml(c)}</span></div>
      <div class="ob-actions"><button type="button" class="ob-icon danger" data-del-crit="${i}" aria-label="${t('Quitar criterio')}" title="${t('Quitar')}">${Icons.svg('x', 15)}</button></div>
    </div>`).join('') : `<div class="ob-empty">${t('Sumá lo que tiene que pasar para que tomes este setup (ej. "Barrida de liquidez en zona de 4H").')}</div>`;
  box.querySelectorAll('[data-del-crit]').forEach(b=> b.addEventListener('click', ()=>{ pbDraft.criteria.splice(Number(b.dataset.delCrit), 1); renderEditorCriteria(); }));
}
function addCriterion(){
  const inp = document.getElementById('pbNewCrit');
  const v = inp.value.trim();
  if(!v){ inp.focus(); return; }
  if(pbDraft.criteria.length >= 15){ document.getElementById('pbError').textContent = t('Podés cargar hasta 15 criterios.'); return; }
  pbDraft.criteria.push(v.slice(0, 200));
  inp.value = '';
  renderEditorCriteria();
  inp.focus();
}
function renderEditorImage(){
  const box = document.getElementById('pbImgBox');
  box.innerHTML = pbDraft.img
    ? `<div class="img-preview"><img src="${pbDraft.img}" alt="${t('Ejemplo del setup')}">
        <div class="img-preview-actions">
          <label class="small-btn" for="pbImgInput">${Icons.svg('repeat', 14)} ${t('Cambiar')}</label>
          <button type="button" class="small-btn" id="pbImgRemove">${Icons.svg('x', 14)} ${t('Quitar')}</button>
        </div></div>`
    : `<label class="pb-img-drop" for="pbImgInput">${Icons.svg('image-up', 22)}<span>${t('Subí una captura de un ejemplo de manual')}</span></label>`;
  const rm = document.getElementById('pbImgRemove');
  if(rm) rm.addEventListener('click', ()=>{ pbDraft.img = null; renderEditorImage(); });
}
document.getElementById('pbImgInput').addEventListener('change', async e=>{
  const f = e.target.files[0];
  e.target.value = '';
  if(!f || !f.type.startsWith('image/')) return;
  try{ pbDraft.img = await resizeImage(f, 1200, 0.75); renderEditorImage(); }
  catch(err){ console.error('image error', err); }
});
document.getElementById('pbAddCrit').addEventListener('click', addCriterion);
document.getElementById('pbNewCrit').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); addCriterion(); } });
document.getElementById('pbCancel').addEventListener('click', closeSetupEditor);
document.getElementById('pbClose').addEventListener('click', closeSetupEditor);

document.getElementById('pbSave').addEventListener('click', ()=>{
  const err = document.getElementById('pbError');
  // Si escribió un criterio y no tocó "Agregar", se suma igual.
  if(document.getElementById('pbNewCrit').value.trim()) addCriterion();
  const name = document.getElementById('pbName').value.trim().slice(0, 60);
  const description = document.getElementById('pbDesc').value.trim().slice(0, 2000);
  if(!name){ err.textContent = t('Poné un nombre al setup.'); return; }
  const clash = setupByName(name);
  if(clash && clash.id !== pbDraft.id){ err.textContent = t('Ya tenés un setup con ese nombre.'); return; }
  const prev = pbDraft.id ? state.playbook.find(x=> x.id === pbDraft.id) : null;
  // Renombrar: los trades con el nombre anterior pasan al nuevo (si el usuario quiere).
  let renamed = [];
  if(prev && setupKey(prev.name) !== setupKey(name)){
    const old = state.history.filter(h=> setupKey(h.setup) === setupKey(prev.name));
    if(old.length && confirm(tp(old.length, '¿Cambiar también el setup de 1 trade de "{old}" a "{name}"?', '¿Cambiar también el setup de los {n} trades de "{old}" a "{name}"?', {old: prev.name, name}))) renamed = old;
  }
  const entry = prev || {id: 'pb_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), createdAt: Date.now(), archived: false};
  const oldImageId = entry.imageId || null;
  Object.assign(entry, {name, description, criteria: pbDraft.criteria.slice()});
  // La captura va a IndexedDB como las de los trades.
  let newImage = null;
  if(!pbDraft.img){ entry.imageId = null; entry.image = null; }
  else if(pbDraft.img !== setupImage(prev)){
    if(ImageStore.available){ entry.imageId = newImageId(); entry.image = null; newImage = entry.imageId; ImageStore.cache.set(entry.imageId, pbDraft.img); }
    else { entry.imageId = null; entry.image = pbDraft.img; }
  }
  if(!prev) state.playbook.push(entry);
  const before = renamed.map(h=> [h, h.setup]);
  renamed.forEach(h=> h.setup = name);
  if(!saveState()){
    before.forEach(([h, s])=> h.setup = s);
    if(!prev) state.playbook.pop();
    err.textContent = t('No se pudo guardar: el almacenamiento del navegador está lleno.');
    return;
  }
  if(newImage) ImageStore.put(newImage, pbDraft.img).catch(()=>{});
  if(oldImageId && oldImageId !== entry.imageId) ImageStore.remove(oldImageId);
  closeSetupEditor();
  renderAll();
  openSetup(entry.id);
});

document.getElementById('pbDelete').addEventListener('click', ()=>{
  const p = state.playbook.find(x=> x.id === pbDraft.id);
  if(!p) return;
  const n = state.history.filter(h=> setupKey(h.setup) === setupKey(p.name)).length;
  if(!confirm(n ? tp(n, '¿Eliminar la ficha de "{name}"? El trade que lo usa conserva el nombre del setup.', '¿Eliminar la ficha de "{name}"? Los {n} trades que lo usan conservan el nombre del setup.', {name: p.name}) : t('¿Eliminar la ficha de "{name}"?', {name: p.name}))) return;
  state.playbook = state.playbook.filter(x=> x !== p);
  saveState();
  if(p.imageId) ImageStore.remove(p.imageId);
  closeSetupEditor();
  renderAll();
});
document.getElementById('pbNewBtn').addEventListener('click', ()=> openSetupEditor(null));

// ---------- Formulario de trade ----------

// Paso 1 del formulario: los criterios del setup elegido, para tildar junto con las reglas.
function renderSetupHint(){
  const box = document.getElementById('setupHint');
  const typed = document.getElementById('setupInput').value.trim();
  const p = setupByName(typed);
  if(!p){
    box.style.display = typed ? '' : 'none';
    box.innerHTML = typed ? `<div class="sh-none">${t('"{name}" no tiene ficha en tu plan, así que no suma criterios.', {name: escapeHtml(typed)})}
      <button type="button" class="link-btn" id="setupHintNew">${t('Crear setup')}</button></div>` : '';
    const nb = document.getElementById('setupHintNew');
    if(nb) nb.addEventListener('click', ()=> openSetupEditor(null, typed));
    return;
  }
  const img = setupImage(p);
  box.style.display = '';
  box.innerHTML = `<div class="sh-top"><span class="set-sub">${t('Criterios de {name}', {name: escapeHtml(p.name)})}</span>${img ? `<button type="button" class="link-btn" id="setupHintImg">${t('Ver ejemplo')}</button>` : ''}</div>
    ${p.criteria.length ? `<div class="rule-grid">${p.criteria.map((c, i)=> `
      <button type="button" class="rule-tile ${tradeForm.critChecked.has(c) ? 'on' : ''}" data-crit="${i}" aria-pressed="${tradeForm.critChecked.has(c)}">
        <span class="rule-check">${Icons.svg('circle-check', 20)}</span>
        <span class="rule-txt"><span class="label">${escapeHtml(c)}</span></span>
      </button>`).join('')}</div>` : `<span class="sh-none">${t('Este setup no tiene criterios cargados.')}</span>`}`;
  const b = document.getElementById('setupHintImg');
  if(b) b.addEventListener('click', ()=> openLightbox(img));
  box.querySelectorAll('[data-crit]').forEach(tile=> tile.addEventListener('click', ()=>{
    const c = p.criteria[Number(tile.dataset.crit)];
    if(tradeForm.critChecked.has(c)) tradeForm.critChecked.delete(c); else tradeForm.critChecked.add(c);
    tradeForm.planTouched = planProgress().done > 0;
    planEditedInForm = true;
    renderSetupHint();
    renderTradeFormStatus();
  }));
}
document.getElementById('setupInput').addEventListener('input', ()=>{
  // Al editar, cambiar de setup cambia los criterios: el plan del trade se vuelve a calcular.
  if(editingTradeId && setupKey(document.getElementById('setupInput').value) !== setupKey(editOriginalSetup)) planEditedInForm = true;
  renderSetupHint();
  renderTradeFormStatus();
});

renderPlaybook.tab = 'playbook';
onDataChange.push(renderPlaybook, ()=>{ renderSetupHint(); renderTradeFormStatus(); });
renderOrDefer(renderPlaybook);
