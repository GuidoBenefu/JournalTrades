// Escapa texto escrito por el usuario (reglas del Trading Plan) antes de meterlo en HTML.
function escapeHtml(str){
  return String(str == null ? '' : str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

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
};

function loadState(){
  const saved = JournalStore.load();
  if(saved) Object.assign(state, saved);
  // Cada usuario arma su propio Trading Plan: no hay reglas por defecto.
  if(!Array.isArray(state.items)) state.items = [];
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
  const fmt = v => (v>0?'+':'') + v.toFixed(2) + '%';

  function colorFor(ratio){
    if(ratio >= 0.8) return 'var(--danger)';
    if(ratio >= 0.5) return 'var(--amber)';
    return 'var(--success)';
  }
  function limitRow(title, limit, used, extra){
    used = Math.max(0, used);
    const ratio = Math.min(used/limit, 1);
    const left = Math.max(0, limit - used);
    const breached = used >= limit;
    return `<div class="fp-row">
      <div class="top"><span>${title}</span><span>${used.toFixed(2)}% / ${limit}%</span></div>
      <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:${colorFor(ratio)};"></div></div>
      <div class="sub">${breached ? 'Límite alcanzado o superado' : 'Te quedan ' + left.toFixed(2) + '%'} · ${extra}</div>
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
      <div class="top"><span>Profit target</span><span>${prog.toFixed(2)}% / ${target}%</span></div>
      <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:var(--success);"></div></div>
      <div class="sub">${reached ? 'Objetivo alcanzado' : 'Te falta ' + (target-prog).toFixed(2) + '%'} · Acumulado: ${fmt(cum)}</div>
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
  btn.textContent = 'Agregar trade';
}

function resetForm(){
  state.items.forEach(it=> state.checked[it.id] = false);
  saveState();
  renderChecklist();
  document.getElementById('riskInput').value = '';
  document.getElementById('durationInput').value = '';
  document.getElementById('resultSelect').value = '';
  document.getElementById('resultPctInput').value = '';
  document.getElementById('resultNote').value = '';
  currentImageData = null;
  document.getElementById('tradeImageInput').value = '';
  renderImagePreview();
  updateAddButton();
}

function addEntry(entry){
  state.history.unshift(entry);
  saveState();
  autoCloseCompletedMonths();
  renderHistory();
  renderStats();
  renderStreak();
  renderCompare();
  renderItemStats();
  renderCurrentPeriod();
  renderClosedMonths();
  renderCalendar();
  renderPlanCalendar();
  renderFundedProgress();
}

document.getElementById('addTradeBtn').addEventListener('click', ()=>{
  const errBox = document.getElementById('entryError');
  errBox.style.display = 'none';

  const riskRaw = document.getElementById('riskInput').value.trim().replace(',', '.');
  const riskPct = riskRaw === '' ? null : parseFloat(riskRaw);
  if(riskRaw !== '' && isNaN(riskPct)){
    errBox.textContent = 'El riesgo tiene que ser un número (ej. 0.5).';
    errBox.style.display = 'block';
    return;
  }

  const durationRaw = document.getElementById('durationInput').value.trim().replace(',', '.');
  const durationMin = durationRaw === '' ? null : parseFloat(durationRaw);
  if(durationRaw !== '' && isNaN(durationMin)){
    errBox.textContent = 'La duración tiene que ser un número de minutos (ej. 12).';
    errBox.style.display = 'block';
    return;
  }

  const result = document.getElementById('resultSelect').value;
  if(!result){
    errBox.textContent = 'Elegí un resultado antes de registrar.';
    errBox.style.display = 'block';
    return;
  }

  const pctRaw = document.getElementById('resultPctInput').value.trim().replace(',', '.');
  let resultPct = null;
  if(pctRaw !== ''){
    resultPct = parseFloat(pctRaw);
    if(isNaN(resultPct)){
      errBox.textContent = 'El resultado tiene que ser un número (ej. 1.2 o -0.5).';
      errBox.style.display = 'block';
      return;
    }
  }

  const note = document.getElementById('resultNote').value.trim();
  const missing = state.items.filter(it=>!state.checked[it.id]).map(it=>it.label);
  const missingIds = state.items.filter(it=>!state.checked[it.id]).map(it=>it.id);
  const followedPlan = missing.length === 0;

  addEntry({
    id: genItemId(),
    ts: Date.now(),
    followedPlan,
    missing,
    missingIds,
    result,
    resultPct,
    riskPct,
    durationMin,
    note,
    image: currentImageData
  });

  resetForm();
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
  const color = broken ? 'var(--danger)' : (ratio >= 0.8 ? 'var(--danger)' : (ratio >= 0.5 ? 'var(--amber)' : 'var(--success)'));
  const msg = broken
    ? '<span style="color:var(--danger); font-weight:600;">Risk management roto hoy: arriesgaste ' + used.toFixed(2) + '% y tu máximo es ' + max + '%.</span>'
    : 'Te quedan ' + (max - used).toFixed(2) + '% de riesgo para hoy.';
  box.innerHTML = `<div class="fp-row">
    <div class="top"><span>Riesgo tomado hoy</span><span>${used.toFixed(2)}% / ${max}%</span></div>
    <div class="bar"><div class="fill" style="width:${Math.round(ratio*100)}%; background:${color};"></div></div>
    <div class="sub">${msg}</div>
  </div>`;
}

document.getElementById('maxDailyRiskInput').addEventListener('input', e=>{
  state.maxDailyRisk = e.target.value;
  saveState();
  renderHistory();
  renderCurrentPeriod();
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
  state.history.slice(0,50).forEach(h=>{
    const div = document.createElement('div');
    div.className = 'hentry';
    const hasRisk = h.riskPct !== null && h.riskPct !== undefined;
    const hasRes = h.resultPct !== null && h.resultPct !== undefined;
    let resCls = 'neu', resTxt = '—';
    if(hasRes){
      resCls = h.resultPct > 0 ? 'pos' : (h.resultPct < 0 ? 'neg' : 'neu');
      resTxt = (h.resultPct > 0 ? '+' : '') + h.resultPct + '%';
    } else if(h.result === 'win'){ resCls = 'pos'; resTxt = 'Ganador'; }
    else if(h.result === 'loss'){ resCls = 'neg'; resTxt = 'Perdedor'; }
    else if(h.result === 'be'){ resTxt = 'BE'; }
    const riskBroken = maxRisk !== null && (riskMap[dayKeyFromTs(h.ts)] || 0) > maxRisk;
    const planCls = h.followedPlan ? 'ok' : 'bad';
    const planTxt = h.followedPlan ? 'Plan seguido' : 'Plan roto';
    const details = [];
    details.push(`<div class="hl">¿Qué pasó en el desarrollo del trade?</div><div class="hnote">${h.note ? h.note.replace(/</g,'&lt;').replace(/\n/g,'<br>') : '<span style="color:var(--text-3);">Sin comentarios.</span>'}</div>`);
    if(h.image) details.push(`<img src="${h.image}" class="tradeThumb histThumb" data-full="${h.image}">`);
    if(h.missing && h.missing.length) details.push(`<div class="miss">Faltó: ${h.missing.map(escapeHtml).join(', ')}</div>`);
    if(h.durationMin !== null && h.durationMin !== undefined) details.push(`<div class="note">Duración: ${h.durationMin} min</div>`);
    div.innerHTML = `
      <div class="hsum">
        <div class="hcol"><div class="hl">Fecha</div><div class="hv date">${fmtDate(h.ts)}</div></div>
        <div class="hcol"><div class="hl">Riesgo</div><div class="hv">${hasRisk ? h.riskPct + '%' : '—'}</div></div>
        <div class="hcol"><div class="hl">Resultado</div><div class="hv ${resCls}">${resTxt}</div></div>
        <div class="hright">
          <div class="hplan ${planCls}">${planTxt}</div>
          ${riskBroken ? '<div class="hrisk">Risk management roto</div>' : ''}
        </div>
      </div>
      <div class="hdetail" style="display:none;">
        ${details.join('')}
        <div class="row" style="margin-top:10px;">
          <button class="danger-o delTradeBtn" data-id="${h.id || ''}" data-ts="${h.ts}" style="padding:4px 10px; font-size:12px;">Eliminar trade</button>
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
  box.querySelectorAll('.delTradeBtn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.dataset.id;
      const ts = Number(btn.dataset.ts);
      const idx = id
        ? state.history.findIndex(h=>h.id === id)
        : state.history.findIndex(h=>h.ts === ts);
      if(idx === -1) return;
      state.history.splice(idx, 1);
      saveState();
      renderHistory();
      renderStats();
      renderStreak();
      renderCompare();
      renderItemStats();
      renderCurrentPeriod();
      renderCalendar();
      renderPlanCalendar();
      renderFundedProgress();
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
    <div class="stat"><div class="n">${sumPct > 0 ? '+' : ''}${sumPct.toFixed(2)}%</div><div class="l">Resultado acumulado</div></div>
    <div class="stat"><div class="n">${avgPct === null ? '—' : (avgPct > 0 ? '+' : '') + avgPct.toFixed(2) + '%'}</div><div class="l">Resultado prom./trade</div></div>
    <div class="stat"><div class="n">${avgRisk === null ? '—' : avgRisk.toFixed(2) + '%'}</div><div class="l">Riesgo promedio</div></div>
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
    <div class="l">TRADES SEGUIDOS SIGUIENDO EL PLAN</div>
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
        <div class="n" style="margin-top:6px;">${s.avg === null ? '—' : (s.avg>0?'+':'') + s.avg.toFixed(2) + '%'}</div>
        <div class="l">prom./trade</div>
        <div class="n" style="margin-top:6px;">${s.avgDuration === null ? '—' : Math.round(s.avgDuration) + ' min'}</div>
        <div class="l">duración prom./trade</div>
        <div class="n" style="margin-top:6px;">${s.sum > 0 ? '+' : ''}${s.sum.toFixed(2)}%</div>
        <div class="l">acumulado</div>
      </div>`;
  }
  box.innerHTML = col('Plan seguido', followed) + col('Plan roto', broken);
}

let calViewDate = new Date();

function dayKeyFromTs(ts){
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function renderCalendar(){
  const label = document.getElementById('calMonthLabel');
  const grid = document.getElementById('calendarGrid');
  const year = calViewDate.getFullYear();
  const month = calViewDate.getMonth();
  label.textContent = calViewDate.toLocaleDateString('es-AR', {month:'long', year:'numeric'});

  const sums = {};
  state.history.forEach(h=>{
    if(h.resultPct === null || h.resultPct === undefined) return;
    const d = new Date(h.ts);
    if(d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = dayKeyFromTs(h.ts);
    sums[key] = (sums[key] || 0) + h.resultPct;
  });

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7; // lunes=0

  let html = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom','Sem'].map(d=>`<div class="dow">${d}</div>`).join('');
  let cellCount = 0, weekSum = 0, weekHas = false;
  function flushWeek(){
    let cls = 'calday week', pctHtml = '';
    if(weekHas){
      cls += weekSum > 0 ? ' pos' : (weekSum < 0 ? ' neg' : '');
      pctHtml = `<div class="pct">${weekSum>0?'+':''}${weekSum.toFixed(2)}%</div>`;
    }
    html += `<div class="${cls}"><div class="num">Sem</div>${pctHtml}</div>`;
    weekSum = 0; weekHas = false;
  }
  function addCell(cell){ html += cell; cellCount++; if(cellCount % 7 === 0) flushWeek(); }
  for(let i=0;i<startOffset;i++){
    addCell('<div class="calday empty"></div>');
  }
  for(let day=1; day<=daysInMonth; day++){
    const key = year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    const sum = sums[key];
    let cls = 'calday';
    let pctHtml = '';
    if(sum !== undefined){
      cls += sum > 0 ? ' pos' : (sum < 0 ? ' neg' : '');
      pctHtml = `<div class="pct">${sum>0?'+':''}${sum.toFixed(2)}%</div>`;
      weekSum += sum; weekHas = true;
    }
    addCell(`<div class="${cls}"><div class="num">${day}</div>${pctHtml}</div>`);
  }
  while(cellCount % 7 !== 0){ addCell('<div class="calday empty"></div>'); }
  grid.innerHTML = html;
}

document.getElementById('calPrevBtn').addEventListener('click', ()=>{
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth()-1, 1);
  renderCalendar();
});
document.getElementById('calNextBtn').addEventListener('click', ()=>{
  calViewDate = new Date(calViewDate.getFullYear(), calViewDate.getMonth()+1, 1);
  renderCalendar();
});

let calViewDate2 = new Date();

function renderPlanCalendar(){
  const label = document.getElementById('calMonthLabel2');
  const grid = document.getElementById('calendarGrid2');
  const year = calViewDate2.getFullYear();
  const month = calViewDate2.getMonth();
  label.textContent = calViewDate2.toLocaleDateString('es-AR', {month:'long', year:'numeric'});

  const dayCounts = {};
  state.history.forEach(h=>{
    const d = new Date(h.ts);
    if(d.getFullYear() !== year || d.getMonth() !== month) return;
    const key = dayKeyFromTs(h.ts);
    if(!dayCounts[key]) dayCounts[key] = {total:0, followed:0};
    dayCounts[key].total++;
    if(h.followedPlan) dayCounts[key].followed++;
  });

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7;

  let html = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom','Sem'].map(d=>`<div class="dow">${d}</div>`).join('');
  let cellCount = 0, weekTotal = 0, weekFollowed = 0;
  function flushWeek(){
    let cls = 'calday week', pctHtml = '';
    if(weekTotal > 0){
      const wp = Math.round((weekFollowed/weekTotal)*100);
      cls += wp === 100 ? ' pos' : (wp === 0 ? ' neg' : ' warn');
      pctHtml = `<div class="pct">${wp}%</div>`;
    }
    html += `<div class="${cls}"><div class="num">Sem</div>${pctHtml}</div>`;
    weekTotal = 0; weekFollowed = 0;
  }
  function addCell(cell){ html += cell; cellCount++; if(cellCount % 7 === 0) flushWeek(); }
  for(let i=0;i<startOffset;i++){
    addCell('<div class="calday empty"></div>');
  }
  for(let day=1; day<=daysInMonth; day++){
    const key = year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    const info = dayCounts[key];
    let cls = 'calday';
    let pctHtml = '';
    if(info){
      const pct = Math.round((info.followed/info.total)*100);
      if(pct === 100) cls += ' pos';
      else if(pct === 0) cls += ' neg';
      else cls += ' warn';
      pctHtml = `<div class="pct">${pct}%</div>`;
      weekTotal += info.total; weekFollowed += info.followed;
    }
    addCell(`<div class="${cls}"><div class="num">${day}</div>${pctHtml}</div>`);
  }
  while(cellCount % 7 !== 0){ addCell('<div class="calday empty"></div>'); }
  grid.innerHTML = html;
}

document.getElementById('calPrevBtn2').addEventListener('click', ()=>{
  calViewDate2 = new Date(calViewDate2.getFullYear(), calViewDate2.getMonth()-1, 1);
  renderPlanCalendar();
});
document.getElementById('calNextBtn2').addEventListener('click', ()=>{
  calViewDate2 = new Date(calViewDate2.getFullYear(), calViewDate2.getMonth()+1, 1);
  renderPlanCalendar();
});

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
      <div class="bar"><div class="fill" style="width:${r.pct}%; background:var(--success);"></div></div>
    </div>
  `).join('');
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
      <div class="stat"><div class="n">${s.sum>0?'+':''}${s.sum.toFixed(2)}%</div><div class="l">Acumulado</div></div>
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
      <span>${m.sum>0?'+':''}${m.sum.toFixed(2)}% <span class="l">(${m.count} trades, ${m.followedPct}% plan${m.avgPerDay !== null && m.avgPerDay !== undefined ? ', ' + m.avgPerDay.toFixed(1) + ' trades/día' : ''}${m.riskMgmtPct !== null && m.riskMgmtPct !== undefined ? ', ' + m.riskMgmtPct + '% risk mgmt' : ''})</span></span>
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
    renderHistory();
    renderStats();
    updateAddButton();
    renderStreak();
    renderCompare();
    renderItemStats();
    renderCurrentPeriod();
    renderClosedMonths();
    renderCalendar();
    renderPlanCalendar();
    renderFundedProgress();
    restoreResetButton();
  });
  document.getElementById('resetCancelBtn').addEventListener('click', restoreResetButton);
}

function restoreResetButton(){
  document.getElementById('resetArea').innerHTML = '<button class="ghost" id="resetBtn">Borrar todo el historial</button>';
  attachResetHandler();
}

attachResetHandler();

document.querySelectorAll('.tabbtn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tabpage').forEach(p=> p.classList.toggle('active', p.dataset.tab === tab));
    document.querySelectorAll('.tabbtn').forEach(b=> b.classList.toggle('active', b === btn));
    document.getElementById('pageTitle').textContent = btn.dataset.title;
    document.querySelector('main.content').scrollTop = 0;
    window.scrollTo(0,0);
  });
});

loadState();
autoCloseCompletedMonths();
renderAccountTypePills();
document.getElementById('maxDailyRiskInput').value = state.maxDailyRisk || '';
renderItemsManager();
renderChecklist();
renderHistory();
renderStats();
updateAddButton();
renderStreak();
renderCompare();
renderItemStats();
renderCurrentPeriod();
renderClosedMonths();
renderCalendar();
renderPlanCalendar();
renderFundedProgress();
