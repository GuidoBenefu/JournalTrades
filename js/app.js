// Escapa texto escrito por el usuario (reglas del Trading Plan) antes de meterlo en HTML.
function escapeHtml(str){
  return String(str == null ? '' : str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Datos extra de cada trade: emoción, errores y sesión.
const EMOTIONS = [
  {id:'calm', label:'Tranquilo', ic:'😌'},
  {id:'confident', label:'Confiado', ic:'💪'},
  {id:'anxious', label:'Ansioso', ic:'😰'},
  {id:'fomo', label:'FOMO', ic:'🏃'},
  {id:'revenge', label:'Revancha', ic:'😤'},
  {id:'bored', label:'Aburrido', ic:'🥱'},
];
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

// Sesión según la hora de Nueva York del momento de entrada.
function sessionOf(ts){
  const h = Number(new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York', hour:'numeric', hourCycle:'h23'}).format(new Date(ts)));
  if(h >= 19 || h < 3) return 'Asia';
  if(h < 8) return 'Londres';
  if(h < 17) return 'Nueva York';
  return 'Fuera de sesión';
}

// R real = resultado / riesgo (ej. +1% arriesgando 0.5% = +2R).
function realR(h){
  if(h.resultPct === null || h.resultPct === undefined || !h.riskPct) return null;
  return h.resultPct / h.riskPct;
}

function fmtSignedPct(v){
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}

function toLocalInputValue(ts){
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Lo que se eligió en el formulario y no vive en un input.
const tradeForm = {direction: null, confidence: null, emotion: null, errors: []};
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
  if(!currentImageData){ box.innerHTML = ''; return; }
  box.innerHTML = `<img src="${currentImageData}" class="tradeThumb"><div class="row" style="margin-top:6px;"><button type="button" class="ghost" id="removeImageBtn" style="padding:4px 10px; font-size:12px;">Quitar imagen</button></div>`;
  document.getElementById('removeImageBtn').addEventListener('click', ()=>{
    currentImageData = null;
    document.getElementById('tradeImageInput').value = '';
    renderImagePreview();
  });
}

document.getElementById('tradeImageInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  try{
    currentImageData = await resizeImage(file, 900, 0.7);
    renderImagePreview();
  }catch(err){
    console.error('image error', err);
  }
});

document.getElementById('lightbox').addEventListener('click', ()=>{
  document.getElementById('lightbox').style.display = 'none';
});

const state = {
  checked: {},
  history: [],
  bestStreak: 0,
  closedMonths: [],
  items: null,
  accountType: null,
  maxDailyRisk: '',
  fundedRules: {dailyDrawdown: '', totalDrawdown: '', profitTarget: '', ddType: 'static', ddLock: false},
  goals: {planPct: 80},
  reviews: {},
  achievements: {},
};

function loadState(){
  const saved = JournalStore.load();
  if(saved) Object.assign(state, saved);
  // Cada usuario arma su propio Trading Plan: no hay reglas por defecto.
  if(!Array.isArray(state.items)) state.items = [];
  if(!state.goals) state.goals = {planPct: 80};
  if(!state.reviews) state.reviews = {};
  if(!state.achievements) state.achievements = {};
  sortHistory();
}
function saveState(){
  if(JournalStore.save(state)) hideStorageWarning();
}

function showStorageWarning(msg){
  const box = document.getElementById('storageWarning');
  box.textContent = msg;
  box.style.display = 'block';
}
function hideStorageWarning(){
  document.getElementById('storageWarning').style.display = 'none';
}

JournalStore.onSaveError = reason=>{
  showStorageWarning(reason === 'quota'
    ? 'No se pudo guardar: el almacenamiento del navegador está lleno. Exportá un backup y borrá trades viejos o imágenes.'
    : 'No se pudo guardar en el navegador. Exportá un backup desde Ajustes para no perder datos.');
};

document.getElementById('exportBtn').addEventListener('click', ()=>{
  JournalStore.exportToFile(state);
});
document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importInput').click();
});
document.getElementById('importInput').addEventListener('change', async e=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const msg = document.getElementById('backupMsg');
  try{
    const data = JournalStore.parseImport(await file.text());
    if(!confirm('Esto reemplaza todos los datos actuales por los del backup. ¿Continuar?')) return;
    if(JournalStore.save(data)) location.reload();
  }catch(err){
    msg.textContent = err.message || 'No se pudo leer el archivo.';
    msg.style.display = 'block';
  }
});

function todayKey(){
  return new Date().toISOString().slice(0,10);
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
  const fmt = v => (v>0?'+':'') + v.toFixed(1) + '%';

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
      <div class="top"><span>${title}</span><span>${used.toFixed(1)}% / ${limit}%</span></div>
      <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:${colorFor(ratio)};"></div></div>
      <div class="sub">${breached ? 'Límite alcanzado o superado' : 'Te quedan ' + left.toFixed(1) + '%'} · ${extra}</div>
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
      <div class="top"><span>Profit target</span><span>${prog.toFixed(1)}% / ${target}%</span></div>
      <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:var(--brand);"></div></div>
      <div class="sub">${reached ? 'Objetivo alcanzado' : 'Te falta ' + (target-prog).toFixed(1) + '%'} · Acumulado: ${fmt(cum)}</div>
    </div>`;
  }
  box.innerHTML = html || '<p style="font-size:13px; color:var(--text-2);">Cargá al menos una regla en "Tipo de cuenta".</p>';
}

function renderAccountTypePills(){
  document.querySelectorAll('#accountTypePills .pill').forEach(btn=>{
    btn.classList.toggle('active', state.accountType === btn.dataset.type);
  });
  const section = document.getElementById('fundedRulesSection');
  section.style.display = state.accountType === 'funded' ? 'block' : 'none';
  document.getElementById('dailyDrawdownInput').value = state.fundedRules.dailyDrawdown || '';
  document.getElementById('totalDrawdownInput').value = state.fundedRules.totalDrawdown || '';
  document.getElementById('profitTargetInput').value = state.fundedRules.profitTarget || '';
  const curDd = state.fundedRules.ddType === 'trailing' ? 'trailing' : 'static';
  document.querySelectorAll('#ddTypePills .pill').forEach(btn=>{
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

document.querySelectorAll('#ddTypePills .pill').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.fundedRules.ddType = btn.dataset.dd;
    saveState();
    renderAccountTypePills();
  });
});

document.querySelectorAll('#accountTypePills .pill').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.accountType = (state.accountType === btn.dataset.type) ? null : btn.dataset.type;
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

function renderItemsManager(){
  const box = document.getElementById('itemsManager');
  box.innerHTML = state.items.map(it=>{
    if(editingItemId === it.id){
      return `
        <div class="editRow" data-id="${it.id}">
          <input type="text" class="editLabel" value="${it.label.replace(/"/g,'&quot;')}">
          <input type="text" class="editHint" value="${(it.hint||'').replace(/"/g,'&quot;')}">
          <div class="row">
            <button class="primary editSaveBtn" data-id="${it.id}">Guardar</button>
            <button class="ghost editCancelBtn">Cancelar</button>
          </div>
        </div>`;
    }
    return `
      <div class="manageItem">
        <div class="txt">
          <div>${escapeHtml(it.label)}</div>
          ${it.hint ? `<div class="hint">${escapeHtml(it.hint)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="ghost editBtn" data-id="${it.id}">Editar</button>
          <button class="danger-o delBtn" data-id="${it.id}">Eliminar</button>
        </div>
      </div>`;
  }).join('') || '<p style="font-size:13px; color:var(--text-2);">Tu Trading Plan está vacío. Agregá la primera regla abajo.</p>';

  box.querySelectorAll('.editBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      editingItemId = btn.dataset.id;
      renderItemsManager();
    });
  });
  box.querySelectorAll('.delBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.items = state.items.filter(it=>it.id !== btn.dataset.id);
      delete state.checked[btn.dataset.id];
      saveState();
      renderItemsManager();
      renderChecklist();
      updateAddButton();
    });
  });
  box.querySelectorAll('.editCancelBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      editingItemId = null;
      renderItemsManager();
    });
  });
  box.querySelectorAll('.editSaveBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const row = box.querySelector(`.editRow[data-id="${btn.dataset.id}"]`);
      const label = row.querySelector('.editLabel').value.trim();
      const hint = row.querySelector('.editHint').value.trim();
      if(!label) return;
      const it = state.items.find(it=>it.id === btn.dataset.id);
      if(it){ it.label = label; it.hint = hint; }
      saveState();
      editingItemId = null;
      renderItemsManager();
      renderChecklist();
    });
  });
}

document.getElementById('addItemBtn').addEventListener('click', ()=>{
  const labelInput = document.getElementById('newItemLabel');
  const hintInput = document.getElementById('newItemHint');
  const label = labelInput.value.trim();
  const hint = hintInput.value.trim();
  if(!label) return;
  state.items.push({id: genItemId(), label, hint});
  saveState();
  labelInput.value = '';
  hintInput.value = '';
  renderItemsManager();
  renderChecklist();
  updateAddButton();
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
    return;
  }
  state.items.forEach(it=>{
    const div = document.createElement('div');
    div.className = 'item' + (state.checked[it.id] ? ' checked' : '');
    div.innerHTML = `
      <input type="checkbox" ${state.checked[it.id] ? 'checked' : ''} data-id="${it.id}">
      <div>
        <div class="label">${escapeHtml(it.label)}</div>
        ${it.hint ? `<div class="hint">${escapeHtml(it.hint)}</div>` : ''}
      </div>`;
    box.appendChild(div);
  });
  box.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change', e=>{
      state.checked[e.target.dataset.id] = e.target.checked;
      saveState();
      renderChecklist();
      updateAddButton();
    });
  });
  box.querySelectorAll('.item').forEach((div, i)=>{
    div.addEventListener('click', e=>{
      if(e.target.tagName === 'INPUT') return;
      const cb = div.querySelector('input');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });
}

function updateAddButton(){
  const btn = document.getElementById('addTradeBtn');
  btn.disabled = false;
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
  emo.innerHTML = EMOTIONS.map(e=>`<button type="button" class="chip ${tradeForm.emotion === e.id ? 'active' : ''}" data-v="${e.id}"><span>${e.ic}</span> ${e.label}</button>`).join('');
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
  document.querySelectorAll('#directionSeg button').forEach(b=> b.classList.toggle('active', b.dataset.v === tradeForm.direction));
  document.querySelectorAll('#confidenceSeg button').forEach(b=> b.classList.toggle('active', b.dataset.v === String(tradeForm.confidence)));
}

document.querySelectorAll('#directionSeg button').forEach(b=> b.addEventListener('click', ()=>{
  tradeForm.direction = tradeForm.direction === b.dataset.v ? null : b.dataset.v;
  renderChips();
}));
document.querySelectorAll('#confidenceSeg button').forEach(b=> b.addEventListener('click', ()=>{
  const v = Number(b.dataset.v);
  tradeForm.confidence = tradeForm.confidence === v ? null : v;
  renderChips();
}));

function parseNum(raw){
  raw = String(raw || '').trim().replace(',', '.');
  if(raw === '') return null;
  const n = parseFloat(raw);
  return isNaN(n) ? NaN : n;
}

function renderFormHints(){
  const val = document.getElementById('entryTimeInput').value;
  const ts = val ? new Date(val).getTime() : Date.now();
  document.getElementById('sessionHint').textContent = isNaN(ts) ? '' : 'Sesión: ' + sessionOf(ts);
  const risk = parseNum(document.getElementById('riskInput').value);
  const res = parseNum(document.getElementById('resultPctInput').value);
  const r = (typeof risk === 'number' && !isNaN(risk) && risk > 0 && typeof res === 'number' && !isNaN(res)) ? res / risk : null;
  document.getElementById('rrRealHint').textContent = r === null ? '' : 'R real: ' + (r > 0 ? '+' : '') + r.toFixed(1) + 'R';
}
['entryTimeInput', 'riskInput', 'resultPctInput'].forEach(id=> document.getElementById(id).addEventListener('input', renderFormHints));

// Sugerencias de activos y setups a partir de lo que ya cargó.
function renderDatalists(){
  const uniq = key => [...new Set(state.history.map(h=> h[key]).filter(Boolean))];
  document.getElementById('assetList').innerHTML = uniq('asset').map(v=> `<option value="${escapeHtml(v)}">`).join('');
  document.getElementById('setupList').innerHTML = uniq('setup').map(v=> `<option value="${escapeHtml(v)}">`).join('');
}

function resetForm(){
  editingTradeId = null;
  state.items.forEach(it=> state.checked[it.id] = false);
  saveState();
  renderChecklist();
  ['riskInput', 'durationInput', 'resultSelect', 'resultPctInput', 'resultNote', 'rrPlanInput', 'setupInput'].forEach(id=> document.getElementById(id).value = '');
  // El activo se mantiene: suele repetirse de un trade al siguiente.
  if(!state.history.length) document.getElementById('assetInput').value = '';
  else document.getElementById('assetInput').value = state.history[0].asset || '';
  document.getElementById('entryTimeInput').value = toLocalInputValue(Date.now());
  Object.assign(tradeForm, {direction: null, confidence: null, emotion: null, errors: []});
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
  const missing = new Set(h.missingIds || []);
  state.items.forEach(it=> state.checked[it.id] = !missing.has(it.id));
  renderChecklist();
  document.getElementById('entryTimeInput').value = toLocalInputValue(h.ts);
  document.getElementById('assetInput').value = h.asset || '';
  document.getElementById('setupInput').value = h.setup || '';
  document.getElementById('riskInput').value = h.riskPct ?? '';
  document.getElementById('rrPlanInput').value = h.rrPlanned ?? '';
  document.getElementById('resultSelect').value = h.result || '';
  document.getElementById('resultPctInput').value = h.resultPct ?? '';
  document.getElementById('durationInput').value = h.durationMin ?? '';
  document.getElementById('resultNote').value = h.note || '';
  Object.assign(tradeForm, {direction: h.direction || null, confidence: h.confidence || null, emotion: h.emotion || null, errors: [...(h.errors || [])]});
  currentImageData = h.image || null;
  renderImagePreview();
  renderChips();
  renderFormHints();
  updateAddButton();
  showTab('register');
}

document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

// Vuelve a dibujar todo lo que depende de los trades. Los módulos nuevos
// (inicio, análisis, revisión) se suman con onDataChange.push(fn).
const onDataChange = [];
function renderAll(){
  autoCloseCompletedMonths();
  renderHistory();
  renderStats();
  renderStreak();
  renderCompare();
  renderItemStats();
  renderCurrentPeriod();
  renderClosedMonths();
  renderFundedProgress();
  renderDatalists();
  onDataChange.forEach(fn=> fn());
}

document.getElementById('addTradeBtn').addEventListener('click', ()=>{
  const errBox = document.getElementById('entryError');
  errBox.style.display = 'none';
  const fail = msg=>{ errBox.textContent = msg; errBox.style.display = 'block'; };

  const riskPct = parseNum(document.getElementById('riskInput').value);
  if(Number.isNaN(riskPct)) return fail('El riesgo tiene que ser un número (ej. 0.5).');
  const rrPlanned = parseNum(document.getElementById('rrPlanInput').value);
  if(Number.isNaN(rrPlanned)) return fail('El R:R planeado tiene que ser un número (ej. 2).');
  const durationMin = parseNum(document.getElementById('durationInput').value);
  if(Number.isNaN(durationMin)) return fail('La duración tiene que ser un número de minutos (ej. 12).');
  const result = document.getElementById('resultSelect').value;
  if(!result) return fail('Elegí un resultado antes de registrar.');
  const resultPct = parseNum(document.getElementById('resultPctInput').value);
  if(Number.isNaN(resultPct)) return fail('El resultado tiene que ser un número (ej. 1.2 o -0.5).');
  const timeVal = document.getElementById('entryTimeInput').value;
  const ts = timeVal ? new Date(timeVal).getTime() : Date.now();
  if(isNaN(ts)) return fail('Revisá la fecha y hora de entrada.');
  if(ts > Date.now() + 5 * 60 * 1000) return fail('La fecha de entrada no puede ser futura.');

  const missingItems = state.items.filter(it=>!state.checked[it.id]);
  const data = {
    ts,
    followedPlan: missingItems.length === 0,
    missing: missingItems.map(it=>it.label),
    missingIds: missingItems.map(it=>it.id),
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
    image: currentImageData,
  };

  if(editingTradeId){
    const h = state.history.find(x=> x.id === editingTradeId);
    if(h) Object.assign(h, data, {editedAt: Date.now()});
  } else {
    state.history.push({id: genItemId(), loggedAt: Date.now(), ...data});
  }
  sortHistory();
  saveState();
  const wasEditing = !!editingTradeId;
  resetForm();
  renderAll();
  if(wasEditing) showTab('history');
});

function fmtDate(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'2-digit'});
}

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
  if(max === null){ box.innerHTML = ''; return; }
  const used = dayRiskMap()[dayKeyFromTs(Date.now())] || 0;
  const broken = used > max;
  const ratio = Math.min(used / max, 1);
  const color = broken ? 'var(--danger)' : (ratio >= 0.8 ? 'var(--danger)' : (ratio >= 0.5 ? 'var(--amber)' : 'var(--brand)'));
  const msg = broken
    ? '<span style="color:var(--danger); font-weight:600;">Risk management roto hoy: arriesgaste ' + used.toFixed(1) + '% y tu máximo es ' + max + '%.</span>'
    : 'Te quedan ' + (max - used).toFixed(1) + '% de riesgo para hoy.';
  box.innerHTML = `<div class="fp-row">
    <div class="top"><span>Riesgo tomado hoy</span><span>${used.toFixed(1)}% / ${max}%</span></div>
    <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:${color};"></div></div>
    <div class="sub">${msg}</div>
  </div>`;
}

document.getElementById('maxDailyRiskInput').addEventListener('input', e=>{
  state.maxDailyRisk = e.target.value;
  saveState();
  renderAll();
});

function renderHistory(){
  const box = document.getElementById('hist');
  renderDailyRisk();
  if(state.history.length === 0){
    box.innerHTML = '<div class="empty">Todavía no registraste ningún trade.</div>';
    return;
  }
  box.innerHTML = '';
  const riskMap = dayRiskMap();
  const maxRisk = getMaxDailyRisk();
  state.history.forEach(h=>{
    const div = document.createElement('div');
    div.className = 'hentry';
    const hasRisk = h.riskPct !== null && h.riskPct !== undefined;
    const hasRes = h.resultPct !== null && h.resultPct !== undefined;
    let resCls = 'neu', resTxt = '—';
    if(hasRes){
      resCls = h.resultPct > 0 ? 'pos' : (h.resultPct < 0 ? 'neg' : 'neu');
      resTxt = (h.resultPct > 0 ? '+' : '') + h.resultPct.toFixed(1) + '%';
    } else if(h.result === 'win'){ resCls = 'pos'; resTxt = 'Ganador'; }
    else if(h.result === 'loss'){ resCls = 'neg'; resTxt = 'Perdedor'; }
    else if(h.result === 'be'){ resTxt = 'BE'; }
    const riskBroken = maxRisk !== null && (riskMap[dayKeyFromTs(h.ts)] || 0) > maxRisk;
    const planCls = h.followedPlan ? 'ok' : 'bad';
    const planTxt = h.followedPlan ? 'Plan seguido' : 'Plan roto';
    const details = [];
    const tags = [];
    if(h.asset) tags.push(`<span class="tag strong">${escapeHtml(h.asset)}</span>`);
    if(h.direction) tags.push(`<span class="tag">${h.direction === 'long' ? 'Long ↑' : 'Short ↓'}</span>`);
    tags.push(`<span class="tag">${sessionOf(h.ts)} · ${new Date(h.ts).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'})}</span>`);
    if(h.setup) tags.push(`<span class="tag">${escapeHtml(h.setup)}</span>`);
    const emo = emotionById(h.emotion);
    if(emo) tags.push(`<span class="tag">${emo.ic} ${emo.label}</span>`);
    if(h.confidence) tags.push(`<span class="tag">Confianza ${h.confidence}/5</span>`);
    details.push(`<div class="tags">${tags.join('')}</div>`);
    const facts = [];
    const r = realR(h);
    if(h.rrPlanned) facts.push(`R:R planeado 1:${h.rrPlanned}`);
    if(r !== null) facts.push(`R real ${r > 0 ? '+' : ''}${r.toFixed(1)}R`);
    if(h.durationMin !== null && h.durationMin !== undefined) facts.push(`Duración ${h.durationMin} min`);
    if(facts.length) details.push(`<div class="note">${facts.join(' · ')}</div>`);
    if(h.errors && h.errors.length) details.push(`<div class="tags">${h.errors.map(id=> errorById(id)).filter(Boolean).map(e=>`<span class="tag bad">${e.label}</span>`).join('')}</div>`);
    if(h.missing && h.missing.length) details.push(`<div class="miss">Faltó del plan: ${h.missing.map(escapeHtml).join(', ')}</div>`);
    details.push(`<div class="hl" style="margin-top:10px;">¿Qué pasó en el desarrollo del trade?</div><div class="hnote">${h.note ? escapeHtml(h.note).replace(/\n/g,'<br>') : '<span style="color:var(--text-3);">Sin comentarios.</span>'}</div>`);
    if(h.image) details.push(`<img src="${h.image}" class="tradeThumb histThumb" data-full="${h.image}">`);
    div.innerHTML = `
      <div class="hsum">
        <div class="hcol"><div class="hl">Fecha</div><div class="hv date">${fmtDate(h.ts)}</div></div>
        <div class="hcol"><div class="hl">Riesgo</div><div class="hv">${hasRisk ? h.riskPct.toFixed(1) + '%' : '—'}</div></div>
        <div class="hcol"><div class="hl">Resultado</div><div class="hv ${resCls}">${resTxt}</div></div>
        <div class="hright">
          <div class="hplan ${planCls}">${planTxt}</div>
          ${riskBroken ? '<div class="hrisk">Risk management roto</div>' : ''}
        </div>
      </div>
      <div class="hdetail" style="display:none;">
        ${details.join('')}
        <div class="row" style="margin-top:12px;">
          <button class="small editTradeBtn" data-id="${h.id || ''}">Editar</button>
          <button class="danger-o small delTradeBtn" data-id="${h.id || ''}" data-ts="${h.ts}">Eliminar</button>
        </div>
      </div>
    `;
    box.appendChild(div);
  });
  box.querySelectorAll('.hsum').forEach(sum=>{
    sum.addEventListener('click', ()=>{
      const d = sum.parentElement.querySelector('.hdetail');
      d.style.display = d.style.display === 'none' ? 'block' : 'none';
    });
  });
  box.querySelectorAll('.histThumb').forEach(img=>{
    img.addEventListener('click', ()=>{
      document.getElementById('lightboxImg').src = img.dataset.full;
      document.getElementById('lightbox').style.display = 'flex';
    });
  });
  box.querySelectorAll('.editTradeBtn').forEach(btn=>{
    btn.addEventListener('click', ()=> startEditTrade(btn.dataset.id));
  });
  box.querySelectorAll('.delTradeBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.id;
      const ts = Number(btn.dataset.ts);
      const idx = id
        ? state.history.findIndex(h=>h.id === id)
        : state.history.findIndex(h=>h.ts === ts);
      if(idx === -1) return;
      if(!confirm('¿Eliminar este trade? No se puede deshacer.')) return;
      state.history.splice(idx, 1);
      saveState();
      renderAll();
    });
  });
}

function renderStats(){
  const box = document.getElementById('stats');
  const total = state.history.length;
  const followed = state.history.filter(h=>h.followedPlan).length;
  const pct = total ? Math.round((followed/total)*100) : 0;
  const withResult = state.history.filter(h=>h.result);
  const wins = withResult.filter(h=>h.result==='win').length;
  const winRate = withResult.length ? Math.round((wins/withResult.length)*100) : 0;

  const pcts = state.history.filter(h=>h.resultPct !== null && h.resultPct !== undefined).map(h=>h.resultPct);
  const sumPct = pcts.reduce((a,b)=>a+b, 0);
  const avgPct = pcts.length ? (sumPct/pcts.length) : null;

  const risks = state.history.filter(h=>h.riskPct !== null && h.riskPct !== undefined).map(h=>h.riskPct);
  const avgRisk = risks.length ? (risks.reduce((a,b)=>a+b,0)/risks.length) : null;

  const durations = state.history.filter(h=>h.durationMin !== null && h.durationMin !== undefined).map(h=>h.durationMin);
  const avgDuration = durations.length ? (durations.reduce((a,b)=>a+b,0)/durations.length) : null;

  const checklistPcts = state.items.length ? state.history.map(h=>{
    const missingCount = (h.missing && h.missing.length) ? h.missing.length : 0;
    const checkedCount = state.items.length - missingCount;
    return (checkedCount / state.items.length) * 100;
  }) : [];
  const avgChecklistPct = checklistPcts.length ? (checklistPcts.reduce((a,b)=>a+b,0)/checklistPcts.length) : null;

  box.innerHTML = `
    <div class="stat"><div class="n">${total}</div><div class="l">Trades</div></div>
    <div class="stat"><div class="n">${pct}%</div><div class="l">Siguió el plan</div></div>
    <div class="stat"><div class="n">${winRate}%</div><div class="l">Win rate</div></div>
    <div class="stat"><div class="n">${sumPct > 0 ? '+' : ''}${sumPct.toFixed(1)}%</div><div class="l">Resultado acumulado</div></div>
    <div class="stat"><div class="n">${avgPct === null ? '—' : (avgPct > 0 ? '+' : '') + avgPct.toFixed(1) + '%'}</div><div class="l">Resultado prom./trade</div></div>
    <div class="stat"><div class="n">${avgRisk === null ? '—' : avgRisk.toFixed(1) + '%'}</div><div class="l">Riesgo promedio</div></div>
    <div class="stat"><div class="n">${avgDuration === null ? '—' : Math.round(avgDuration) + ' min'}</div><div class="l">Duración promedio</div></div>
    <div class="stat"><div class="n">${avgChecklistPct === null ? '—' : Math.round(avgChecklistPct) + '%'}</div><div class="l">Prom. ítems tildados</div></div>
  `;
}

function renderStreak(){
  const box = document.getElementById('streakBox');
  let streak = 0;
  for(const h of state.history){
    if(h.followedPlan) streak++;
    else break;
  }
  if(streak > state.bestStreak){
    state.bestStreak = streak;
    saveState();
  }
  box.innerHTML = `
    <div class="n ${streak === 0 ? 'zero' : ''}">${streak}</div>
    <div class="l">${streak === 1 ? 'trade seguido' : 'trades seguidos'} respetando tu Trading Plan</div>
    <div class="best">Mejor racha: ${state.bestStreak}</div>
  `;
}

function renderCompare(){
  const box = document.getElementById('compareBox');
  function summarize(list){
    const withPct = list.filter(h=>h.resultPct !== null && h.resultPct !== undefined);
    const sum = withPct.reduce((a,h)=>a+h.resultPct, 0);
    const avg = withPct.length ? sum/withPct.length : null;
    const withDuration = list.filter(h=>h.durationMin !== null && h.durationMin !== undefined);
    const avgDuration = withDuration.length ? withDuration.reduce((a,h)=>a+h.durationMin, 0)/withDuration.length : null;
    return {count: list.length, sum, avg, avgDuration};
  }
  const followed = summarize(state.history.filter(h=>h.followedPlan));
  const broken = summarize(state.history.filter(h=>!h.followedPlan));
  function col(title, s){
    return `
      <div class="col">
        <h3>${title}</h3>
        <div class="n">${s.count}</div>
        <div class="l">trades</div>
        <div class="n" style="margin-top:6px;">${s.avg === null ? '—' : (s.avg>0?'+':'') + s.avg.toFixed(1) + '%'}</div>
        <div class="l">prom./trade</div>
        <div class="n" style="margin-top:6px;">${s.avgDuration === null ? '—' : Math.round(s.avgDuration) + ' min'}</div>
        <div class="l">duración prom./trade</div>
        <div class="n" style="margin-top:6px;">${s.sum > 0 ? '+' : ''}${s.sum.toFixed(1)}%</div>
        <div class="l">acumulado</div>
      </div>`;
  }
  box.innerHTML = col('Plan seguido', followed) + col('Plan roto', broken);
}

function renderItemStats(){
  const box = document.getElementById('itemStats');
  if(!state.items.length){
    box.innerHTML = '<div class="empty">Armá tu Trading Plan en Ajustes para ver qué reglas cumplís más.</div>';
    return;
  }
  if(state.history.length === 0){
    box.innerHTML = '<div class="empty">Todavía no hay datos suficientes.</div>';
    return;
  }
  const total = state.history.length;
  const missingCounts = {};
  state.items.forEach(it=> missingCounts[it.id] = 0);
  state.history.forEach(h=>{
    let ids = h.missingIds;
    if(!ids && h.missing && h.missing.length){
      ids = state.items.filter(it=> h.missing.includes(it.label)).map(it=>it.id);
    }
    (ids || []).forEach(id=>{ if(missingCounts[id] !== undefined) missingCounts[id]++; });
  });
  const rows = state.items.map(it=>{
    const c = total - missingCounts[it.id];
    const pct = total ? Math.round((c/total)*100) : 0;
    return {label: it.label, c, pct};
  }).sort((a,b)=> b.pct - a.pct);
  box.innerHTML = rows.map(r=>`
    <div class="itemstat">
      <div class="top"><span>${escapeHtml(r.label)}</span><span>${r.pct}% (${r.c})</span></div>
      <div class="bar"><div class="fill" style="width:${r.pct}%; background:var(--brand);"></div></div>
    </div>
  `).join('');
}

function dayKeyFromTs(ts){
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function monthKeyOf(ts){
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function monthLabelOf(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('es-AR', {month:'long', year:'numeric'});
}

function monthLabel(){
  return monthLabelOf(Date.now());
}

function summarizePeriod(list){
  const total = list.length;
  const followed = list.filter(h=>h.followedPlan).length;
  const pct = total ? Math.round((followed/total)*100) : 0;
  const withPct = list.filter(h=>h.resultPct !== null && h.resultPct !== undefined);
  const sum = withPct.reduce((a,h)=>a+h.resultPct, 0);
  let avgPerDay = null;
  if(total > 0){
    const startTs = Math.min(...list.map(h=>h.ts));
    const endTs = Math.max(...list.map(h=>h.ts));
    const startDay = new Date(startTs); startDay.setHours(0,0,0,0);
    const endDay = new Date(endTs); endDay.setHours(0,0,0,0);
    const days = Math.round((endDay - startDay)/(1000*60*60*24)) + 1;
    avgPerDay = total / days;
  }
  const riskMgmtPct = computeRiskMgmtPct(list);
  return {total, pct, sum, avgPerDay, riskMgmtPct};
}

function autoCloseCompletedMonths(){
  const currentKey = monthKeyOf(Date.now());
  const closedKeys = new Set(state.closedMonths.map(m=>m.monthKey));
  const pastKeys = new Set(
    state.history
      .map(h=>monthKeyOf(h.ts))
      .filter(k=>k !== currentKey && !closedKeys.has(k))
  );
  if(pastKeys.size === 0) return;
  const sortedKeys = Array.from(pastKeys).sort();
  sortedKeys.forEach(key=>{
    const monthTrades = state.history.filter(h=>monthKeyOf(h.ts) === key);
    const s = summarizePeriod(monthTrades);
    state.closedMonths.push({
      monthKey: key,
      label: monthLabelOf(monthTrades[0].ts),
      count: s.total,
      sum: s.sum,
      followedPct: s.pct,
      avgPerDay: s.avgPerDay,
      riskMgmtPct: s.riskMgmtPct,
      closedAt: Date.now()
    });
  });
  saveState();
}

function renderCurrentPeriod(){
  const box = document.getElementById('currentPeriod');
  const currentKey = monthKeyOf(Date.now());
  const current = state.history.filter(h => monthKeyOf(h.ts) === currentKey);
  const s = summarizePeriod(current);
  box.innerHTML = `
    <p style="font-size:13px; color:var(--text-2); margin:0 0 10px;">Período actual: ${monthLabel()} (se cierra solo al terminar el mes)</p>
    <div class="stats">
      <div class="stat"><div class="n">${s.total}</div><div class="l">Trades</div></div>
      <div class="stat"><div class="n">${s.pct}%</div><div class="l">Siguió el plan</div></div>
      <div class="stat"><div class="n">${s.sum>0?'+':''}${s.sum.toFixed(1)}%</div><div class="l">Acumulado</div></div>
      <div class="stat"><div class="n">${s.avgPerDay === null ? '—' : s.avgPerDay.toFixed(1)}</div><div class="l">Prom. trades/día</div></div>
      <div class="stat"><div class="n">${s.riskMgmtPct === null ? '—' : s.riskMgmtPct + '%'}</div><div class="l">Risk management</div></div>
    </div>
  `;
}

function renderClosedMonths(){
  const box = document.getElementById('closedMonths');
  if(!state.closedMonths.length){
    box.innerHTML = '';
    return;
  }
  box.innerHTML = state.closedMonths.slice().reverse().map(m=>`
    <div class="monthrow">
      <span>${m.label}</span>
      <span>${m.sum>0?'+':''}${m.sum.toFixed(1)}% <span class="l">(${m.count} trades, ${m.followedPct}% plan${m.avgPerDay !== null && m.avgPerDay !== undefined ? ', ' + m.avgPerDay.toFixed(1) + ' trades/día' : ''}${m.riskMgmtPct !== null && m.riskMgmtPct !== undefined ? ', ' + m.riskMgmtPct + '% risk mgmt' : ''})</span></span>
    </div>
  `).join('');
}

function attachResetHandler(){
  document.getElementById('resetBtn').addEventListener('click', showResetConfirm);
}

function showResetConfirm(){
  const area = document.getElementById('resetArea');
  area.innerHTML = `
    <p style="font-size:13px; color:var(--danger); margin:0 0 8px;">¿Borrar todo el historial y desbloquear? No se puede deshacer.</p>
    <div class="row">
      <button class="danger-o" id="resetConfirmBtn">Sí, borrar todo</button>
      <button class="ghost" id="resetCancelBtn">Cancelar</button>
    </div>
  `;
  document.getElementById('resetConfirmBtn').addEventListener('click', ()=>{
    state.history = [];
    state.bestStreak = 0;
    state.closedMonths = [];
    saveState();
    renderAll();
    restoreResetButton();
  });
  document.getElementById('resetCancelBtn').addEventListener('click', restoreResetButton);
}

function restoreResetButton(){
  document.getElementById('resetArea').innerHTML = '<button class="ghost" id="resetBtn">Borrar todo el historial</button>';
  attachResetHandler();
}

attachResetHandler();

function showTab(tab){
  const btn = document.querySelector('.tabbtn[data-tab="' + tab + '"]');
  if(!btn) return;
  document.querySelectorAll('.tabpage').forEach(p=> p.classList.toggle('active', p.dataset.tab === tab));
  document.querySelectorAll('.tabbtn').forEach(b=> b.classList.toggle('active', b === btn));
  document.getElementById('pageTitle').textContent = btn.dataset.title;
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
