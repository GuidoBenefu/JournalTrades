// Escapa texto escrito por el usuario (reglas del Trading Plan) antes de meterlo en HTML.
function escapeHtml(str){
  return String(str == null ? '' : str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Datos extra de cada trade: emoción, errores y sesión.
const EMOTIONS = [
  {id:'calm', label:'Tranquilo', tone:'good'},
  {id:'confident', label:'Confiado', tone:'good'},
  {id:'anxious', label:'Ansioso', tone:'risk'},
  {id:'fomo', label:'FOMO', tone:'risk'},
  {id:'revenge', label:'Revancha', tone:'risk'},
  {id:'bored', label:'Aburrido', tone:'risk'},
];
const RESULT_LABELS = {win: 'Ganador', loss: 'Perdedor', be: 'Break even'};
const CONFIDENCE_LABELS = ['', 'Nada seguro', 'Poco seguro', 'Neutral', 'Bastante seguro', 'Totalmente seguro'];
const ERROR_TAGS = [
  {id:'moved_sl', label:'Moví el stop'},
  {id:'early_exit', label:'Cerré antes de tiempo'},
  {id:'late_entry', label:'Entré tarde'},
  {id:'no_confirmation', label:'Entré sin confirmación'},
  {id:'overtrading', label:'Sobreoperé'},
  {id:'size_up', label:'Aumenté el tamaño'},
  {id:'ignored_tp', label:'No respeté el TP'},
];
const emotionById = id => EMOTIONS.find(e=>e.id === id);
// Nombre de la emoción dentro de una frase ("con ansioso" → "con ansioso", pero FOMO en mayúsculas).
const emotionWord = e => e.id === 'fomo' ? 'FOMO' : e.label.toLowerCase();
const errorById = id => ERROR_TAGS.find(e=>e.id === id);

// R real = resultado / riesgo (ej. +1% arriesgando 0.5% = +2R).
function realR(h){
  if(h.resultPct === null || h.resultPct === undefined || !h.riskPct) return null;
  return h.resultPct / h.riskPct;
}

// Redondeo a un decimal sin depender del orden de la suma: 79.15 y 79.1499999…
// (el mismo total sumado en otro orden) tienen que mostrarse igual.
function fix1(v){
  return (Math.round(v * 1e6) / 1e6).toFixed(1);
}

function fmtSignedPct(v){
  const r = Math.round(v * 1e6) / 1e6;
  return (r > 0 ? '+' : '') + r.toFixed(1) + '%';
}

// Clase de color por signo, la misma en toda la app. Lo que se ve como "+0.0%" queda neutro.
function signClass(v){
  return v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : '';
}

// Lo que se eligió en el formulario y no vive en un input.
const tradeForm = {result: null, direction: null, confidence: null, emotion: null, errors: [], planTouched: false};
// Al editar: el plan original del trade se conserva salvo que se toquen las reglas.
let editOriginalPlan = null;
let planEditedInForm = false;
// Si el usuario no cambió la hora, el trade se guarda con la hora del momento de guardar.
let entryTimeTouched = false;
// Pestaña desde donde se abrió la edición, para volver ahí al guardar.
let editOriginTab = null;
let editingTradeId = null;

let currentImageData = null;

function resizeImage(file, maxDim, quality){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxDim || h > maxDim){
          if(w > h){ h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderImagePreview(){
  const box = document.getElementById('tradeImagePreview');
  document.getElementById('dropzone').style.display = currentImageData ? 'none' : '';
  if(!currentImageData){ box.innerHTML = ''; renderTradeFormStatus(); return; }
  box.innerHTML = `<div class="img-preview"><img src="${currentImageData}" alt="Captura del trade">
    <div class="img-preview-actions">
      <label class="small-btn" for="tradeImageInput">${Icons.svg('repeat', 14)} Cambiar</label>
      <button type="button" class="small-btn" id="removeImageBtn">${Icons.svg('x', 14)} Quitar</button>
    </div></div>`;
  box.querySelector('img').addEventListener('click', ()=> openLightbox(currentImageData));
  document.getElementById('removeImageBtn').addEventListener('click', ()=>{
    currentImageData = null;
    document.getElementById('tradeImageInput').value = '';
    renderImagePreview();
  });
  renderTradeFormStatus();
}

async function loadTradeImage(file){
  if(!file || !file.type.startsWith('image/')) return;
  try{
    currentImageData = await resizeImage(file, 900, 0.7);
    renderImagePreview();
  }catch(err){
    console.error('image error', err);
  }
}

document.getElementById('tradeImageInput').addEventListener('change', e=> loadTradeImage(e.target.files[0]));

// Arrastrar y soltar, o pegar con Ctrl+V mientras se está en la pestaña Trade.
(function setupDropzone(){
  const dz = document.getElementById('dropzone');
  ['dragenter', 'dragover'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev=> dz.addEventListener(ev, ()=> dz.classList.remove('over')));
  dz.addEventListener('drop', e=>{
    e.preventDefault();
    loadTradeImage(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', e=>{
    if(!document.querySelector('.tabpage[data-tab="register"].active')) return;
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find(i=> i.type.startsWith('image/'));
    if(item) loadTradeImage(item.getAsFile());
  });
})();

function openLightbox(src){
  if(!src) return;
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').style.display = 'flex';
}

document.getElementById('lightbox').addEventListener('click', ()=>{
  document.getElementById('lightbox').style.display = 'none';
});

const state = {
  checked: {},
  history: [],
  bestStreak: 0,
  items: null,
  accountType: null,
  maxDailyRisk: '',
  fundedRules: {dailyDrawdown: '', totalDrawdown: '', profitTarget: '', ddType: 'static', ddLock: false},
  goals: {planPct: 80},
  reviews: {},
  achievements: {},
  timePrefs: {...DEFAULT_TIME_PREFS},
};

function loadState(){
  const saved = JournalStore.load();
  if(saved) Object.assign(state, saved);
  // Cada usuario arma su propio Trading Plan: no hay reglas por defecto.
  if(!Array.isArray(state.items)) state.items = [];
  if(!state.goals) state.goals = {planPct: 80};
  if(!state.reviews) state.reviews = {};
  if(!state.achievements) state.achievements = {};
  state.timePrefs = timePrefs();
  // Antes los meses cerrados se guardaban como foto; ahora se calculan del historial.
  delete state.closedMonths;
  sortHistory();
}
function saveState(){
  const ok = JournalStore.save(state);
  if(ok) hideStorageWarning();
  return ok;
}

function showStorageWarning(msg){
  const box = document.getElementById('storageWarning');
  box.textContent = msg;
  box.style.display = 'block';
}
function hideStorageWarning(){
  document.getElementById('storageWarning').style.display = 'none';
}

JournalStore.onLoadError = ()=>{
  showStorageWarning('No se pudieron leer tus datos guardados (el archivo está dañado). Se guardó una copia aparte; si tenés un backup, importalo desde Ajustes.');
};
JournalStore.onSaveError = reason=>{
  showStorageWarning(reason === 'quota'
    ? 'No se pudo guardar: el almacenamiento del navegador está lleno. Exportá un backup y borrá trades viejos o imágenes.'
    : 'No se pudo guardar en el navegador. Exportá un backup desde Ajustes para no perder datos.');
};

document.getElementById('exportBtn').addEventListener('click', ()=>{
  JournalStore.exportToFile(stateForExport());
});

// El backup lleva las capturas adentro (en la app viven aparte, en IndexedDB).
function stateForExport(){
  return {...state, history: state.history.map(h=>{
    const {imageId, ...rest} = h;
    const img = tradeImage(h);
    return img ? {...rest, image: img} : rest;
  })};
}
document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importInput').click();
});
document.getElementById('importInput').addEventListener('change', async e=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const msg = document.getElementById('backupMsg');
  msg.style.display = 'none';
  try{
    const data = JournalStore.parseImport(await file.text());
    const dropped = data._dropped;
    delete data._dropped;
    if(!confirm(`Esto reemplaza todos los datos actuales por los del backup (${data.history.length} trades${dropped ? `; ${dropped} registros dañados se van a descartar` : ''}). ¿Continuar?`)) return;
    await ImageStore.clearUser();
    if(ImageStore.available){
      for(const h of data.history){
        if(!h.image) continue;
        h.imageId = newImageId();
        await ImageStore.put(h.imageId, h.image);
        delete h.image;
      }
    }
    if(JournalStore.save(data)) location.reload();
  }catch(err){
    msg.textContent = err.message || 'No se pudo leer el archivo.';
    msg.style.display = 'block';
  }
});

// Momento en que se creó una regla (los ids llevan la fecha: item_<ms>_<rand>).
function ruleCreatedAt(it){
  if(it.createdAt) return it.createdAt;
  const m = /^item_(\d{12,})_/.exec(it.id || '');
  return m ? Number(m[1]) : 0;
}

// Reglas que tenía el plan cuando se registró el trade (para trades viejos, se estima).
function rulesTotalOf(h){
  if(h.rulesTotal) return h.rulesTotal;
  return Math.max(state.items.filter(it=> ruleCreatedAt(it) <= h.ts).length, (h.missing || []).length, 1);
}

function genItemId(){
  return 'item_' + Date.now() + '_' + Math.floor(Math.random()*10000);
}

let editingItemId = null;

function renderFundedProgress(){
  const card = document.getElementById('fundedProgressCard');
  const box = document.getElementById('fundedProgress');
  const r = state.fundedRules || {};
  const daily = parseFloat(String(r.dailyDrawdown||'').replace(',','.'));
  const total = parseFloat(String(r.totalDrawdown||'').replace(',','.'));
  const target = parseFloat(String(r.profitTarget||'').replace(',','.'));
  const hasAny = !isNaN(daily) || !isNaN(total) || !isNaN(target);
  if(state.accountType !== 'funded' || !hasAny){ card.style.display = 'none'; return; }
  card.style.display = 'block';

  const withPct = state.history.filter(h=>h.resultPct !== null && h.resultPct !== undefined);
  const todayK = dayKeyFromTs(Date.now());
  const todayPnl = withPct.filter(h=>dayKeyFromTs(h.ts) === todayK).reduce((a,h)=>a+h.resultPct,0);
  const cum = withPct.reduce((a,h)=>a+h.resultPct,0);
  const fmt = fmtSignedPct;

  function colorFor(ratio){
    if(ratio >= 0.8) return 'var(--danger)';
    if(ratio >= 0.5) return 'var(--amber)';
    return 'var(--brand)';
  }
  function limitRow(title, limit, used, extra){
    used = Math.max(0, used);
    const ratio = Math.min(used/limit, 1);
    const left = Math.max(0, limit - used);
    const breached = used >= limit;
    return `<div class="fp-row">
      <div class="top"><span>${title}</span><span>${fix1(used)}% / ${limit}%</span></div>
      <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:${colorFor(ratio)};"></div></div>
      <div class="sub">${breached ? 'Límite alcanzado o superado' : 'Te quedan ' + fix1(left) + '%'} · ${extra}</div>
    </div>`;
  }

  const ddType = r.ddType === 'trailing' ? 'trailing' : 'static';
  const chrono = withPct.slice().sort((a,b)=>a.ts-b.ts);
  let running = 0, peak = 0;
  chrono.forEach(h=>{ running += h.resultPct; if(running > peak) peak = running; });

  let html = '';
  if(!isNaN(daily) && daily > 0) html += limitRow('Drawdown diario', daily, -todayPnl, 'Hoy: ' + fmt(todayPnl));
  if(!isNaN(total) && total > 0){
    if(ddType === 'trailing'){
      const lock = !!r.ddLock;
      const floor = lock ? Math.min(peak - total, 0) : (peak - total);
      const usedT = total - (cum - floor);
      html += limitRow('Drawdown total (trailing' + (lock ? ', congelado en el inicial' : '') + ')', total, usedT, 'Pico: ' + fmt(peak) + ' · Piso: ' + fmt(floor) + ' · Acumulado: ' + fmt(cum));
    } else {
      html += limitRow('Drawdown total (estático)', total, -cum, 'Acumulado: ' + fmt(cum));
    }
  }
  if(!isNaN(target) && target > 0){
    const prog = Math.max(0, cum);
    const ratio = Math.min(prog/target, 1);
    const reached = prog >= target;
    html += `<div class="fp-row">
      <div class="top"><span>Profit target</span><span>${fix1(prog)}% / ${target}%</span></div>
      <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:var(--brand);"></div></div>
      <div class="sub">${reached ? 'Objetivo alcanzado' : 'Te falta ' + fix1(target-prog) + '%'} · Acumulado: ${fmt(cum)}</div>
    </div>`;
  }
  box.innerHTML = html || '<p style="font-size:13px; color:var(--text-2);">Cargá al menos una regla en "Tipo de cuenta".</p>';
}

function renderAccountTypePills(){
  document.querySelectorAll('#accountTypePills .type-card').forEach(btn=>{
    btn.classList.toggle('active', state.accountType === btn.dataset.type);
  });
  const section = document.getElementById('fundedRulesSection');
  section.style.display = state.accountType === 'funded' ? 'block' : 'none';
  document.getElementById('dailyDrawdownInput').value = state.fundedRules.dailyDrawdown || '';
  document.getElementById('totalDrawdownInput').value = state.fundedRules.totalDrawdown || '';
  document.getElementById('profitTargetInput').value = state.fundedRules.profitTarget || '';
  const curDd = state.fundedRules.ddType === 'trailing' ? 'trailing' : 'static';
  document.querySelectorAll('#ddTypePills button').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.dd === curDd);
  });
  document.getElementById('ddLockField').style.display = curDd === 'trailing' ? 'block' : 'none';
  document.getElementById('ddLockInput').checked = !!state.fundedRules.ddLock;
  renderFundedProgress();
}

document.getElementById('ddLockInput').addEventListener('change', e=>{
  state.fundedRules.ddLock = e.target.checked;
  saveState();
  renderFundedProgress();
});

document.querySelectorAll('#ddTypePills button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.fundedRules.ddType = btn.dataset.dd;
    saveState();
    renderAccountTypePills();
  });
});

document.querySelectorAll('#accountTypePills .type-card').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.accountType = btn.dataset.type;
    saveState();
    renderAccountTypePills();
  });
});

document.getElementById('dailyDrawdownInput').addEventListener('input', e=>{
  state.fundedRules.dailyDrawdown = e.target.value;
  saveState();
  renderFundedProgress();
});
document.getElementById('totalDrawdownInput').addEventListener('input', e=>{
  state.fundedRules.totalDrawdown = e.target.value;
  saveState();
  renderFundedProgress();
});
document.getElementById('profitTargetInput').addEventListener('input', e=>{
  state.fundedRules.profitTarget = e.target.value;
  saveState();
  renderFundedProgress();
});

function afterPlanChange(){
  saveState();
  renderItemsManager();
  renderChecklist();
  updateAddButton();
}

function moveItem(id, toIndex){
  const from = state.items.findIndex(it=> it.id === id);
  if(from < 0 || toIndex < 0 || toIndex >= state.items.length || from === toIndex) return;
  const [it] = state.items.splice(from, 1);
  state.items.splice(toIndex, 0, it);
  afterPlanChange();
}

function renderItemsManager(){
  const box = document.getElementById('itemsManager');
  const n = state.items.length;
  document.getElementById('planCount').textContent = n === 1 ? '1 regla' : n + ' reglas';
  box.innerHTML = state.items.map((it, i)=>{
    if(editingItemId === it.id){
      return `
        <div class="editRow" data-id="${it.id}">
          <input type="text" class="editLabel" value="${escapeHtml(it.label)}" aria-label="Regla">
          <input type="text" class="editHint" value="${escapeHtml(it.hint || '')}" placeholder="Aclaración (opcional)" aria-label="Aclaración">
          <div class="row">
            <button class="primary small editSaveBtn" data-id="${it.id}">Guardar</button>
            <button class="ghost small editCancelBtn">Cancelar</button>
          </div>
        </div>`;
    }
    return `
      <div class="rule-row" draggable="true" data-id="${it.id}" data-i="${i}">
        <span class="rule-grip" aria-hidden="true">${Icons.svg('grip-vertical', 16)}</span>
        <span class="rule-num">${i + 1}</span>
        <div class="txt">
          <div class="rule-label">${escapeHtml(it.label)}</div>
          ${it.hint ? `<div class="hint">${escapeHtml(it.hint)}</div>` : ''}
        </div>
        <div class="actions">
          <button type="button" class="icon-btn move-btn upBtn" data-id="${it.id}" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>${Icons.svg('chevron-up', 15)}</button>
          <button type="button" class="icon-btn move-btn downBtn" data-id="${it.id}" aria-label="Bajar" ${i === n - 1 ? 'disabled' : ''}>${Icons.svg('chevron-down', 15)}</button>
          <button type="button" class="icon-btn editBtn" data-id="${it.id}" aria-label="Editar regla">${Icons.svg('pencil', 15)}</button>
          <button type="button" class="icon-btn icon-danger delBtn" data-id="${it.id}" aria-label="Eliminar regla">${Icons.svg('trash', 15)}</button>
        </div>
      </div>`;
  }).join('') || '<div class="rules-empty">Tu Trading Plan está vacío. Agregá la primera regla abajo.</div>';

  const on = (sel, fn)=> box.querySelectorAll(sel).forEach(btn=> btn.addEventListener('click', ()=> fn(btn.dataset.id, btn)));
  on('.editBtn', id=>{ editingItemId = id; renderItemsManager(); const inp = box.querySelector('.editLabel'); if(inp) inp.focus(); });
  on('.delBtn', id=>{
    const it = state.items.find(x=> x.id === id);
    if(!confirm(`¿Eliminar la regla "${it ? it.label : ''}" de tu Trading Plan? Los trades que ya cargaste la siguen mostrando como estaba.`)) return;
    state.items = state.items.filter(it=> it.id !== id);
    delete state.checked[id];
    afterPlanChange();
  });
  on('.upBtn', id=> moveItem(id, state.items.findIndex(it=> it.id === id) - 1));
  on('.downBtn', id=> moveItem(id, state.items.findIndex(it=> it.id === id) + 1));
  on('.editCancelBtn', ()=>{ editingItemId = null; renderItemsManager(); });
  on('.editSaveBtn', id=>{
    const row = box.querySelector(`.editRow[data-id="${id}"]`);
    const label = row.querySelector('.editLabel').value.trim();
    const hint = row.querySelector('.editHint').value.trim();
    if(!label) return;
    const it = state.items.find(it=> it.id === id);
    if(it){ it.label = label; it.hint = hint; }
    editingItemId = null;
    afterPlanChange();
  });
  box.querySelectorAll('.editRow input').forEach(inp=> inp.addEventListener('keydown', e=>{
    if(e.key === 'Enter') box.querySelector('.editSaveBtn').click();
    if(e.key === 'Escape') box.querySelector('.editCancelBtn').click();
  }));

  // Reordenar arrastrando (escritorio). En pantallas táctiles se usan las flechas.
  let dragId = null;
  box.querySelectorAll('.rule-row').forEach(row=>{
    row.addEventListener('dragstart', e=>{ dragId = row.dataset.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); box.querySelectorAll('.drop-over').forEach(r=> r.classList.remove('drop-over')); });
    row.addEventListener('dragover', e=>{ e.preventDefault(); row.classList.add('drop-over'); });
    row.addEventListener('dragleave', ()=> row.classList.remove('drop-over'));
    row.addEventListener('drop', e=>{
      e.preventDefault();
      if(dragId && dragId !== row.dataset.id) moveItem(dragId, Number(row.dataset.i));
    });
  });
}

document.getElementById('addItemBtn').addEventListener('click', ()=>{
  const labelInput = document.getElementById('newItemLabel');
  const hintInput = document.getElementById('newItemHint');
  const label = labelInput.value.trim();
  const hint = hintInput.value.trim();
  if(!label) return;
  state.items.push({id: genItemId(), label, hint, createdAt: Date.now()});
  labelInput.value = '';
  hintInput.value = '';
  hintInput.style.display = 'none';
  document.getElementById('toggleHintBtn').style.display = '';
  afterPlanChange();
  labelInput.focus();
});
['newItemLabel', 'newItemHint'].forEach(id=> document.getElementById(id).addEventListener('keydown', e=>{
  if(e.key === 'Enter') document.getElementById('addItemBtn').click();
}));
document.getElementById('toggleHintBtn').addEventListener('click', e=>{
  e.target.style.display = 'none';
  const hint = document.getElementById('newItemHint');
  hint.style.display = '';
  hint.focus();
});

function renderChecklist(){
  const box = document.getElementById('checklist');
  box.innerHTML = '';
  if(!state.items.length){
    box.innerHTML = `<div class="plan-empty">
      <p>Todavía no armaste tu Trading Plan. Cargá las reglas que tiene que cumplir cada trade y acá vas a poder tildarlas.</p>
      <button type="button" class="primary small" id="goToPlanBtn">Armar mi Trading Plan</button>
    </div>`;
    document.getElementById('goToPlanBtn').addEventListener('click', ()=>{
      document.querySelector('.tabbtn[data-tab="settings"]').click();
      document.getElementById('newItemLabel').focus();
    });
    renderTradeFormStatus();
    return;
  }
  box.innerHTML = `<div class="rule-grid">${state.items.map(it=> `
    <button type="button" class="rule-tile ${state.checked[it.id] ? 'on' : ''}" data-id="${it.id}" aria-pressed="${!!state.checked[it.id]}">
      <span class="rule-check">${Icons.svg('circle-check', 20)}</span>
      <span class="rule-txt"><span class="label">${escapeHtml(it.label)}</span>${it.hint ? `<span class="hint">${escapeHtml(it.hint)}</span>` : ''}</span>
    </button>`).join('')}</div>`;
  box.querySelectorAll('.rule-tile').forEach(t=> t.addEventListener('click', ()=>{
    state.checked[t.dataset.id] = !state.checked[t.dataset.id];
    // Si se desmarcan todas, el paso vuelve a quedar sin responder.
    tradeForm.planTouched = state.items.some(it=> state.checked[it.id]);
    planEditedInForm = true;
    saveState();
    renderChecklist();
  }));
  renderTradeFormStatus();
}

function updateAddButton(){
  const btn = document.getElementById('addTradeBtn');
  btn.textContent = editingTradeId ? 'Guardar cambios' : 'Agregar trade';
  document.getElementById('cancelEditBtn').style.display = editingTradeId ? '' : 'none';
  document.getElementById('tradeFormTitle').textContent = editingTradeId ? 'Editar trade' : 'Registrar trade';
}

// El historial se mantiene ordenado del trade más nuevo al más viejo según
// la hora de entrada (se pueden cargar trades de días anteriores).
function sortHistory(){
  state.history.sort((a, b)=> b.ts - a.ts);
}

function renderChips(){
  const emo = document.getElementById('emotionChips');
  const group = (tone, title)=> `<div class="emo-group emo-${tone}"><div class="emo-group-t">${title}</div><div class="chips">${
    EMOTIONS.filter(e=> e.tone === tone).map(e=>`<button type="button" class="chip chip-${tone} ${tradeForm.emotion === e.id ? 'active' : ''}" data-v="${e.id}">${e.label}</button>`).join('')
  }</div></div>`;
  emo.innerHTML = group('good', 'Estados que ayudan') + group('risk', 'Estados de riesgo');
  emo.querySelectorAll('.chip').forEach(b=> b.addEventListener('click', ()=>{
    tradeForm.emotion = tradeForm.emotion === b.dataset.v ? null : b.dataset.v;
    renderChips();
  }));
  const err = document.getElementById('errorChips');
  err.innerHTML = ERROR_TAGS.map(e=>`<button type="button" class="chip chip-bad ${tradeForm.errors.includes(e.id) ? 'active' : ''}" data-v="${e.id}">${e.label}</button>`).join('');
  err.querySelectorAll('.chip').forEach(b=> b.addEventListener('click', ()=>{
    const id = b.dataset.v;
    tradeForm.errors = tradeForm.errors.includes(id) ? tradeForm.errors.filter(x=> x !== id) : [...tradeForm.errors, id];
    renderChips();
  }));
  document.querySelectorAll('#resultSeg button').forEach(b=> b.classList.toggle('active', b.dataset.v === tradeForm.result));
  document.querySelectorAll('#directionSeg button').forEach(b=> b.classList.toggle('active', b.dataset.v === tradeForm.direction));
  document.querySelectorAll('#confidenceSeg button').forEach(b=> b.classList.toggle('on', tradeForm.confidence !== null && Number(b.dataset.v) <= tradeForm.confidence));
  document.getElementById('confidenceSeg').dataset.level = tradeForm.confidence || '';
  document.getElementById('confidenceLabel').textContent = tradeForm.confidence ? `· ${tradeForm.confidence}/5 · ${CONFIDENCE_LABELS[tradeForm.confidence]}` : '';
  renderTradeFormStatus();
}

document.querySelectorAll('#resultSeg button').forEach(b=> b.addEventListener('click', ()=>{
  tradeForm.result = tradeForm.result === b.dataset.v ? null : b.dataset.v;
  renderChips();
}));
document.querySelectorAll('#directionSeg button').forEach(b=> b.addEventListener('click', ()=>{
  tradeForm.direction = tradeForm.direction === b.dataset.v ? null : b.dataset.v;
  renderChips();
}));
document.querySelectorAll('#confidenceSeg button').forEach(b=> b.addEventListener('click', ()=>{
  const v = Number(b.dataset.v);
  tradeForm.confidence = tradeForm.confidence === v ? null : v;
  renderChips();
}));

// Puntaje de disciplina del trade (0-100): reglas cumplidas (60%), errores (25%)
// y emoción (15%). Solo cuenta lo que ya se respondió: con el formulario vacío
// devuelve null, y la emoción suma recién cuando se elige una.
function disciplineScore(rulesDone, rulesTotal, errorCount, emotionId, planTouched){
  const emo = emotionById(emotionId);
  const touched = planTouched || rulesDone > 0 || errorCount > 0 || !!emo;
  if(!touched) return null;
  const parts = [];
  if(rulesTotal) parts.push([rulesDone / rulesTotal * 100, 60]);
  parts.push([Math.max(0, 100 - errorCount * 34), 25]);
  if(emo) parts.push([emo.tone === 'risk' ? 0 : 100, 15]);
  const weight = parts.reduce((a, p)=> a + p[1], 0);
  return Math.round(parts.reduce((a, p)=> a + p[0] * p[1], 0) / weight);
}

// Estado de cada paso, barra de progreso y tarjeta de vista previa.
function renderTradeFormStatus(){
  if(!state.items) return;
  const val = id=> document.getElementById(id).value.trim();
  const total = state.items.length;
  const done = state.items.filter(it=> state.checked[it.id]).length;
  const steps = {
    plan: total > 0 && (done === total || tradeForm.planTouched),
    trade: !!(tradeForm.result && tradeForm.direction && val('assetInput')),
    mind: !!(tradeForm.emotion && tradeForm.confidence),
    notes: !!(val('resultNote') || currentImageData),
  };
  const n = Object.values(steps).filter(Boolean).length;
  document.querySelectorAll('.fstep').forEach(sec=> sec.classList.toggle('done', steps[sec.dataset.step]));
  document.getElementById('tfProgressFill').style.width = (n / 4 * 100) + '%';
  document.getElementById('tfProgressTxt').textContent = `${n} de 4 secciones completas`;

  const pct = total ? done / total * 100 : 0;
  const meter = document.getElementById('planMeter');
  meter.style.display = total ? '' : 'none';
  meter.className = 'plan-meter ' + (done === total ? 'good' : done === 0 ? '' : 'warn');
  meter.innerHTML = `<div class="pm-top"><span>Cumpliste <b>${done}/${total}</b> reglas</span><span>${done === total ? 'Dentro del plan' : (done || tradeForm.planTouched) ? 'Fuera del plan' : 'Sin marcar'}</span></div>
    <div class="pm-bar"><div style="width:${pct}%"></div></div>`;
  document.getElementById('planStatus').textContent = total ? `${done}/${total}` : '';

  // Vista previa
  const asset = val('assetInput').toUpperCase();
  const risk = parseNum(val('riskInput'));
  const res = parseNum(val('resultPctInput'));
  const rrPlan = parseNum(val('rrPlanInput'));
  const okNum = v=> typeof v === 'number' && !isNaN(v);
  const rReal = okNum(risk) && risk > 0 && okNum(res) ? res / risk : null;
  const timeVal = val('entryTimeInput');
  const ts = timeVal ? fromInputValue(timeVal) : Date.now();
  const emo = emotionById(tradeForm.emotion);
  const score = disciplineScore(done, total, tradeForm.errors.length, tradeForm.emotion, tradeForm.planTouched);
  const scoreCls = score === null ? 'none' : score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';
  const resCls = tradeForm.result === 'win' ? 'pos' : tradeForm.result === 'loss' ? 'neg' : '';
  const row = (l, v)=> `<div class="tp-row"><span>${l}</span><b>${v}</b></div>`;
  const dir = tradeForm.direction
    ? `<span class="tp-dir ${tradeForm.direction}">${Icons.svg(tradeForm.direction === 'long' ? 'arrow-up' : 'arrow-down', 14)}${tradeForm.direction === 'long' ? 'Long' : 'Short'}</span>` : '';
  document.getElementById('tradePreview').innerHTML = `
    <div class="tp-kicker">Vista previa</div>
    <div class="tp-top">
      <div class="tp-asset">${asset ? escapeHtml(asset) : '<span class="tp-ph">Activo</span>'}${dir}</div>
      <div class="tp-res ${resCls}">${okNum(res) ? fmtSignedPct(res) : tradeForm.result ? RESULT_LABELS[tradeForm.result] : '—'}</div>
    </div>
    <div class="tp-sub">${[val('setupInput') && escapeHtml(val('setupInput')), !isNaN(ts) && sessionOf(ts)].filter(Boolean).join(' · ') || 'Completá el formulario y el trade se arma acá.'}</div>
    <div class="tp-rows">
      ${row('R:R planeado', okNum(rrPlan) ? '1:' + rrPlan.toFixed(1) : '—')}
      ${row('R real', rReal === null ? '—' : (rReal > 0 ? '+' : '') + rReal.toFixed(1) + 'R')}
      ${row('Plan respetado', total ? `<span class="${done === total ? 'pos' : 'neg'}">${done === total ? 'Sí' : 'No'} · ${done}/${total}</span>` : '—')}
      ${row('Emoción', emo ? `<span class="${emo.tone === 'risk' ? 'warn' : 'pos'}">${emo.label}</span>` : '—')}
      ${row('Errores', tradeForm.errors.length ? `<span class="neg">${tradeForm.errors.length}</span>` : '0')}
    </div>
    <div class="tp-score ${scoreCls}">
      <div class="tp-ring" style="--p:${score || 0}"><span>${score === null ? '—' : score}</span></div>
      <div><div class="tp-score-t">Puntaje de disciplina</div>
      <div class="tp-score-s">${score === null ? 'Completá el formulario para ver tu puntaje.' : score >= 80 ? 'Trade ejecutado con disciplina.' : score >= 50 ? 'Hay cosas para ajustar.' : 'Este trade se alejó de tu plan.'}</div></div>
    </div>`;
}
['assetInput', 'setupInput', 'riskInput', 'rrPlanInput', 'resultPctInput', 'resultNote', 'entryTimeInput']
  .forEach(id=> document.getElementById(id).addEventListener('input', renderTradeFormStatus));

function parseNum(raw){
  raw = String(raw || '').trim().replace(',', '.');
  if(raw === '') return null;
  const n = parseFloat(raw);
  return isNaN(n) ? NaN : n;
}

function renderFormHints(){
  const val = document.getElementById('entryTimeInput').value;
  const ts = val ? fromInputValue(val) : Date.now();
  document.getElementById('entryTzLabel').textContent = '(' + (timePrefs().display === 'ny' ? 'hora de Nueva York' : 'tu hora local') + ')';
  // La sesión, la hora en las dos zonas y, si cambia, el día de trading en el que cuenta.
  const otherDay = !isNaN(ts) && val && dayKeyFromTs(ts) !== val.slice(0, 10);
  document.getElementById('sessionHint').textContent = isNaN(ts) ? '' :
    ['Sesión: ' + sessionOf(ts), fmtTimeBoth(ts), otherDay && 'Cuenta para el día ' + fmtDate(ts)].filter(Boolean).join(' · ');
  const risk = parseNum(document.getElementById('riskInput').value);
  const res = parseNum(document.getElementById('resultPctInput').value);
  const r = (typeof risk === 'number' && !isNaN(risk) && risk > 0 && typeof res === 'number' && !isNaN(res)) ? res / risk : null;
  document.getElementById('rrRealHint').textContent = r === null ? '' : 'R real: ' + (r > 0 ? '+' : '') + r.toFixed(1) + 'R';
}
['entryTimeInput', 'riskInput', 'resultPctInput'].forEach(id=> document.getElementById(id).addEventListener('input', renderFormHints));
document.getElementById('entryTimeInput').addEventListener('input', ()=>{ entryTimeTouched = true; });

// Sugerencias de activos y setups a partir de lo que ya cargó.
function renderDatalists(){
  const uniq = key => [...new Set(state.history.map(h=> h[key]).filter(Boolean))];
  document.getElementById('assetList').innerHTML = uniq('asset').map(v=> `<option value="${escapeHtml(v)}">`).join('');
  document.getElementById('setupList').innerHTML = uniq('setup').map(v=> `<option value="${escapeHtml(v)}">`).join('');
}

function resetForm(){
  editingTradeId = null;
  editOriginalPlan = null;
  planEditedInForm = false;
  entryTimeTouched = false;
  state.items.forEach(it=> state.checked[it.id] = false);
  saveState();
  renderChecklist();
  ['riskInput', 'durationInput', 'resultPctInput', 'resultNote', 'rrPlanInput', 'setupInput'].forEach(id=> document.getElementById(id).value = '');
  // El activo se mantiene: suele repetirse de un trade al siguiente.
  if(!state.history.length) document.getElementById('assetInput').value = '';
  else document.getElementById('assetInput').value = state.history[0].asset || '';
  document.getElementById('entryTimeInput').value = toLocalInputValue(Date.now());
  Object.assign(tradeForm, {result: null, direction: null, confidence: null, emotion: null, errors: [], planTouched: false});
  currentImageData = null;
  document.getElementById('tradeImageInput').value = '';
  renderImagePreview();
  renderChips();
  renderFormHints();
  updateAddButton();
}

function startEditTrade(id){
  const h = state.history.find(x=> x.id === id);
  if(!h) return;
  editingTradeId = id;
  editOriginTab = activeTab();
  const missing = new Set(h.missingIds || []);
  const missingLabels = new Set(h.missing || []);
  state.items.forEach(it=> state.checked[it.id] = !missing.has(it.id) && !(!h.missingIds && missingLabels.has(it.label)));
  editOriginalPlan = {followedPlan: h.followedPlan, missing: h.missing || [], missingIds: h.missingIds || [], rulesTotal: rulesTotalOf(h)};
  planEditedInForm = false;
  entryTimeTouched = true;
  renderChecklist();
  document.getElementById('entryTimeInput').value = toLocalInputValue(h.ts);
  document.getElementById('assetInput').value = h.asset || '';
  document.getElementById('setupInput').value = h.setup || '';
  document.getElementById('riskInput').value = h.riskPct ?? '';
  document.getElementById('rrPlanInput').value = h.rrPlanned ?? '';
  document.getElementById('resultPctInput').value = h.resultPct ?? '';
  document.getElementById('durationInput').value = h.durationMin ?? '';
  document.getElementById('resultNote').value = h.note || '';
  Object.assign(tradeForm, {result: h.result || null, planTouched: true, direction: h.direction || null, confidence: h.confidence || null, emotion: h.emotion || null, errors: [...(h.errors || [])]});
  currentImageData = tradeImage(h);
  renderImagePreview();
  renderChips();
  renderFormHints();
  updateAddButton();
  showTab('register');
}

document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

// Vuelve a dibujar todo lo que depende de los trades. Los módulos nuevos
// (inicio, análisis, revisión) se suman con onDataChange.push(fn).
// Las funciones con `tab` (ej. renderHome.tab = 'home') se dibujan solo si esa
// pestaña está visible; si no, quedan pendientes hasta que se abra.
const onDataChange = [];
const pendingTabRenders = new Set();
function activeTab(){
  const el = document.querySelector('.tabpage.active');
  return el ? el.dataset.tab : null;
}
function renderOrDefer(fn){
  if(fn.tab && fn.tab !== activeTab()) pendingTabRenders.add(fn);
  else{ pendingTabRenders.delete(fn); fn(); }
}
function renderAll(){
  renderDailyRisk();
  updateBestStreak();
  renderFundedProgress();
  renderDatalists();
  onDataChange.forEach(renderOrDefer);
}

document.getElementById('addTradeBtn').addEventListener('click', ()=>{
  const errBox = document.getElementById('entryError');
  errBox.style.display = 'none';
  const fail = msg=>{ errBox.textContent = msg; errBox.style.display = 'block'; };

  const riskPct = parseNum(document.getElementById('riskInput').value);
  if(Number.isNaN(riskPct)) return fail('El riesgo tiene que ser un número (ej. 0.5).');
  if(riskPct !== null && (riskPct <= 0 || riskPct > 100)) return fail('El riesgo tiene que ser mayor a 0 y como máximo 100%.');
  const rrPlanned = parseNum(document.getElementById('rrPlanInput').value);
  if(Number.isNaN(rrPlanned)) return fail('El R:R planeado tiene que ser un número (ej. 2).');
  if(rrPlanned !== null && rrPlanned <= 0) return fail('El R:R planeado tiene que ser mayor a 0 (ej. 2 para 1:2).');
  const durationMin = parseNum(document.getElementById('durationInput').value);
  if(Number.isNaN(durationMin)) return fail('La duración tiene que ser un número de minutos (ej. 12).');
  if(durationMin !== null && durationMin < 0) return fail('La duración no puede ser negativa.');
  const result = tradeForm.result;
  if(!result) return fail('Elegí un resultado (Ganador, Perdedor o Break even) antes de registrar.');
  const resultPct = parseNum(document.getElementById('resultPctInput').value);
  if(Number.isNaN(resultPct)) return fail('El resultado tiene que ser un número (ej. 1.2 o -0.5).');
  if(resultPct !== null && Math.abs(resultPct) > 100) return fail('Revisá el resultado: no puede ser mayor a 100% ni menor a -100%.');
  if(result === 'win' && resultPct !== null && resultPct < 0) return fail('Marcaste Ganador pero el resultado es negativo. Revisá el resultado o elegí Perdedor.');
  if(result === 'loss' && resultPct !== null && resultPct > 0) return fail('Marcaste Perdedor pero el resultado es positivo. Revisá el resultado o elegí Ganador.');
  const timeVal = document.getElementById('entryTimeInput').value;
  let ts = timeVal ? fromInputValue(timeVal) : Date.now();
  // Si no tocó la hora, se usa la del momento en que guarda (el formulario pudo quedar abierto).
  if(!editingTradeId && !entryTimeTouched) ts = Date.now();
  if(isNaN(ts)) return fail('Revisá la fecha y hora de entrada.');
  if(ts > Date.now() + 5 * 60 * 1000) return fail('La fecha de entrada no puede ser futura.');

  if(editingTradeId && !state.history.some(x=> x.id === editingTradeId)){
    resetForm();
    return fail('Ese trade ya no existe (se eliminó). No se guardaron los cambios.');
  }
  // Sin reglas tildadas el trade queda como plan roto: se confirma para que no sea un olvido.
  const keepPlan = editingTradeId && editOriginalPlan && !planEditedInForm;
  if(!keepPlan && state.items.length && !state.items.some(it=> state.checked[it.id])
    && !confirm('No marcaste ninguna regla de tu Trading Plan. Si guardás así, el trade queda como "Plan roto". ¿Guardar igual?')) return;

  const missingItems = state.items.filter(it=>!state.checked[it.id]);
  const plan = keepPlan ? editOriginalPlan : {
    followedPlan: missingItems.length === 0,
    missing: missingItems.map(it=>it.label),
    missingIds: missingItems.map(it=>it.id),
    rulesTotal: state.items.length,
  };
  // Puntaje de disciplina del trade (el mismo de la vista previa), guardado con el trade.
  const rulesDone = Math.max(0, (plan.rulesTotal || 0) - plan.missing.length);
  const score = disciplineScore(rulesDone, plan.rulesTotal || 0, tradeForm.errors.length, tradeForm.emotion, true);
  const data = {
    ts,
    ...plan,
    score,
    result,
    resultPct,
    riskPct,
    rrPlanned,
    durationMin,
    asset: document.getElementById('assetInput').value.trim().toUpperCase() || null,
    setup: document.getElementById('setupInput').value.trim() || null,
    direction: tradeForm.direction,
    emotion: tradeForm.emotion,
    confidence: tradeForm.confidence,
    errors: [...tradeForm.errors],
    note: document.getElementById('resultNote').value.trim(),
  };
  // La captura se guarda aparte (IndexedDB); el trade solo lleva su id.
  const prev = editingTradeId ? state.history.find(x=> x.id === editingTradeId) : null;
  const prevImage = prev ? tradeImage(prev) : null;
  let imageToRemove = null;
  if(!currentImageData){
    data.imageId = null; data.image = null;
    if(prev) imageToRemove = prev.imageId;
  } else if(prev && currentImageData === prevImage){
    data.imageId = prev.imageId || null; data.image = prev.imageId ? null : prev.image || null;
  } else if(ImageStore.available){
    data.imageId = newImageId(); data.image = null;
    ImageStore.cache.set(data.imageId, currentImageData);
    if(prev) imageToRemove = prev.imageId;
  } else {
    data.imageId = null; data.image = currentImageData;
  }

  let undo;
  if(editingTradeId){
    const h = state.history.find(x=> x.id === editingTradeId);
    const before = {...h};
    Object.assign(h, data, {editedAt: Date.now()});
    undo = ()=>{ Object.keys(h).forEach(k=> delete h[k]); Object.assign(h, before); };
  } else {
    const nuevo = {id: genItemId(), loggedAt: Date.now(), ...data};
    state.history.push(nuevo);
    undo = ()=>{ state.history = state.history.filter(x=> x !== nuevo); };
  }
  sortHistory();
  // Si no se pudo guardar (almacenamiento lleno), se deshace para no mostrar un trade que no existe.
  if(!saveState()){
    undo();
    sortHistory();
    if(data.imageId && data.imageId !== (prev && prev.imageId)) ImageStore.cache.delete(data.imageId);
    return fail('No se pudo guardar el trade porque el almacenamiento del navegador está lleno. Exportá un backup y liberá espacio.');
  }
  if(data.imageId && data.imageId !== (prev && prev.imageId)) ImageStore.put(data.imageId, currentImageData).catch(()=>{});
  if(imageToRemove) ImageStore.remove(imageToRemove);
  const wasEditing = !!editingTradeId;
  resetForm();
  renderAll();
  if(wasEditing) showTab(editOriginTab && editOriginTab !== 'register' ? editOriginTab : 'history');
});

// Formateador reutilizable: crear uno por llamada es lento con miles de trades.

function getMaxDailyRisk(){
  const v = parseFloat(String(state.maxDailyRisk || '').replace(',', '.'));
  return (!isNaN(v) && v > 0) ? v : null;
}

function dayRiskMap(){
  const map = {};
  state.history.forEach(h=>{
    if(h.riskPct === null || h.riskPct === undefined) return;
    const k = dayKeyFromTs(h.ts);
    map[k] = (map[k] || 0) + h.riskPct;
  });
  return map;
}

function computeRiskMgmtPct(list){
  const max = getMaxDailyRisk();
  if(max === null) return null;
  const map = {};
  list.forEach(h=>{
    if(h.riskPct === null || h.riskPct === undefined) return;
    const k = dayKeyFromTs(h.ts);
    map[k] = (map[k] || 0) + h.riskPct;
  });
  const days = Object.keys(map);
  if(days.length === 0) return null;
  const within = days.filter(k => map[k] <= max).length;
  return Math.round((within/days.length)*100);
}

function renderDailyRisk(){
  const box = document.getElementById('dailyRiskStatus');
  const max = getMaxDailyRisk();
  if(max === null){ box.innerHTML = '<div class="risk-gauge empty">Elegí tu riesgo máximo diario para ver cuánto te queda cada día.</div>'; return; }
  const used = dayRiskMap()[dayKeyFromTs(Date.now())] || 0;
  const ratio = used / max;
  const cls = ratio >= 1 ? 'bad' : ratio >= 0.5 ? 'warn' : 'good';
  const label = ratio > 1 ? 'Límite superado' : ratio >= 1 ? 'Límite alcanzado' : ratio >= 0.5 ? 'Cerca del límite' : 'Dentro del límite';
  const msg = ratio > 1
    ? 'Arriesgaste ' + fix1(used) + '% y tu máximo es ' + max + '%. Hoy rompiste tu risk management.'
    : ratio >= 1 ? 'Ya usaste todo tu riesgo de hoy. Lo que sigue es fuera de plan.'
    : 'Te quedan ' + fix1(max - used) + '% de riesgo para hoy.';
  box.innerHTML = `<div class="risk-gauge ${cls}">
    <div class="rg-top">
      <div><div class="rg-l">Riesgo tomado hoy</div><div class="rg-v">${fix1(used)}% <span>/ ${max}%</span></div></div>
      <span class="rg-pill">${label}</span>
    </div>
    <div class="rg-bar"><div style="width:${Math.min(ratio, 1) * 100}%"></div><i style="left:50%"></i></div>
    <div class="rg-sub">${msg}</div>
  </div>`;
}

let riskInputTimer = null;
document.getElementById('maxDailyRiskInput').addEventListener('input', e=>{
  state.maxDailyRisk = e.target.value;
  renderDailyRisk();
  clearTimeout(riskInputTimer);
  riskInputTimer = setTimeout(()=>{ saveState(); renderAll(); }, 400);
});

// Racha actual (desde el trade más nuevo) y mejor racha histórica, siempre
// calculadas sobre el historial: si se borran o editan trades, se ajustan.
function computeStreaks(){
  let current = 0;
  for(const h of state.history){
    if(h.followedPlan) current++;
    else break;
  }
  let run = 0, best = 0;
  for(let i = state.history.length - 1; i >= 0; i--){
    run = state.history[i].followedPlan ? run + 1 : 0;
    if(run > best) best = run;
  }
  return {current, best};
}

// La mejor racha se guarda para los logros y se recalcula con cada cambio.
function updateBestStreak(){
  const {best} = computeStreaks();
  if(best !== state.bestStreak){
    state.bestStreak = best;
    saveState();
  }
}


function monthLabelOf(ts){
  return keyDate(dayKeyFromTs(ts)).toLocaleDateString('es-AR', {month:'long', year:'numeric'});
}

function monthLabel(){
  return monthLabelOf(Date.now());
}

function summarizePeriod(list){
  const total = list.length;
  const followed = list.filter(h=>h.followedPlan).length;
  const pctRaw = total ? followed / total * 100 : 0;
  const withPct = list.filter(h=>h.resultPct !== null && h.resultPct !== undefined);
  const sum = withPct.reduce((a,h)=>a+h.resultPct, 0);
  // Trades por día operado (no por día de calendario).
  const daysTraded = new Set(list.map(h=> dayKeyFromTs(h.ts))).size;
  const avgPerDay = total ? total / daysTraded : null;
  const riskMgmtPct = computeRiskMgmtPct(list);
  return {total, pct: Math.round(pctRaw), pctRaw, sum, avgPerDay, riskMgmtPct};
}

// Meses anteriores al actual, del más nuevo al más viejo. Se calculan siempre
// desde el historial, así reflejan trades cargados, editados o borrados después.
function closedMonthsList(){
  const currentKey = monthKeyOf(Date.now());
  const keys = [...new Set(state.history.map(h=> monthKeyOf(h.ts)))].filter(k=> k !== currentKey).sort().reverse();
  return keys.map(key=>{
    const monthTrades = state.history.filter(h=> monthKeyOf(h.ts) === key);
    const s = summarizePeriod(monthTrades);
    return {monthKey: key, label: monthLabelOf(monthTrades[0].ts), count: s.total, sum: s.sum,
      followedPct: s.pct, followedPctRaw: s.pctRaw, avgPerDay: s.avgPerDay, riskMgmtPct: s.riskMgmtPct};
  });
}

function attachResetHandler(){
  document.getElementById('resetBtn').addEventListener('click', showResetConfirm);
}

function showResetConfirm(){
  const area = document.getElementById('resetArea');
  area.innerHTML = `
    <p style="font-size:13px; color:var(--danger); margin:0 0 8px;">¿Seguro? Se borran todos tus trades y no se puede deshacer.</p>
    <div class="row">
      <button class="danger-o" id="resetConfirmBtn">Sí, borrar todo</button>
      <button class="ghost" id="resetCancelBtn">Cancelar</button>
    </div>
  `;
  document.getElementById('resetConfirmBtn').addEventListener('click', ()=>{
    ImageStore.clearUser();
    state.history = [];
    state.bestStreak = 0;
    saveState();
    renderAll();
    restoreResetButton();
  });
  document.getElementById('resetCancelBtn').addEventListener('click', restoreResetButton);
}

function restoreResetButton(){
  document.getElementById('resetArea').innerHTML = '<button class="danger-o" id="resetBtn">Borrar todo el historial</button>';
  attachResetHandler();
}

attachResetHandler();

function showTab(tab){
  const btn = document.querySelector('.tabbtn[data-tab="' + tab + '"]');
  if(!btn) return;
  document.querySelectorAll('.tabpage').forEach(p=> p.classList.toggle('active', p.dataset.tab === tab));
  document.querySelectorAll('.tabbtn').forEach(b=> b.classList.toggle('active', b === btn));
  document.getElementById('pageTitle').textContent = btn.dataset.title;
  pendingTabRenders.forEach(fn=>{ if(fn.tab === tab){ pendingTabRenders.delete(fn); fn(); } });
  // La hora de entrada se mantiene al día mientras el usuario no la cambie.
  if(tab === 'register' && !editingTradeId && !entryTimeTouched){
    document.getElementById('entryTimeInput').value = toLocalInputValue(Date.now());
    renderFormHints();
  }
  window.scrollTo(0, 0);
  // Los gráficos se dibujan con el ancho real de su tarjeta.
  window.dispatchEvent(new Event('tabshown'));
}

document.querySelectorAll('.tabbtn').forEach(btn=>{
  btn.addEventListener('click', ()=> showTab(btn.dataset.tab));
});
// Links internos: <button data-goto="stats">
document.addEventListener('click', e=>{
  const go = e.target.closest('[data-goto]');
  if(go) showTab(go.dataset.goto);
});

loadState();
renderAccountTypePills();
document.getElementById('maxDailyRiskInput').value = state.maxDailyRisk || '';
renderItemsManager();
resetForm();
renderAll();

// Carga las capturas guardadas aparte y pasa a IndexedDB las que todavía
// estaban dentro del journal (formato viejo).
ImageStore.init(JournalStore.adapter.userId).then(async ()=>{
  if(ImageStore.available){
    const legacy = state.history.filter(h=> h.image);
    for(const h of legacy){
      try{
        const id = newImageId();
        await ImageStore.put(id, h.image);
        h.imageId = id;
        delete h.image;
      }catch(e){ console.warn('No se pudo mover una captura', e); }
    }
    if(legacy.length) saveState();
  }
  renderAll();
});
