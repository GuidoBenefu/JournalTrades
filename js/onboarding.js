// Configuración guiada para cuentas nuevas: tipo de cuenta, Trading Plan (reglas
// generales y el primer setup con sus criterios) y riesgo máximo diario. Usa el estado y las funciones de render de app.js.
(function(){
  const user = JournalAuth.currentUser();
  if(!JournalAuth.needsOnboarding(user)) return;

  const $ = id => document.getElementById(id);
  const num = v => {
    const n = parseFloat(String(v || '').replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  let step = 1;
  const draft = {
    accountType: isPropAccount(state.accounts[0]) ? 'funded' : 'retail',
    ddType: state.accounts[0].rules.ddType || 'static',
    // El Trading Plan se arma desde cero: cada usuario carga sus propias reglas.
    items: [],
    setup: {name: '', description: '', criteria: []},
  };
  const MIN_RULES = 2;
  const MAX_CRITERIA = 15;
  const LAST = 4;
  let editing = null;

  function renderItems(){
    renderRuleCount();
    if(!draft.items.length){
      $('obItems').innerHTML = `<div class="ob-empty">${t('Todavía no agregaste reglas. Empezá por la más importante de tu estrategia.')}</div>`;
      return;
    }
    $('obItems').innerHTML = draft.items.map((it, i)=> editing === i ? `
      <div class="ob-item editing">
        <span class="ob-num">${i + 1}</span>
        <div class="ob-edit">
          <input type="text" class="ob-edit-label" value="${escapeHtml(it.label)}" aria-label="${t('Regla')}">
          <input type="text" class="ob-edit-hint" value="${escapeHtml(it.hint || '')}" placeholder="${t('Aclaración (opcional)')}" aria-label="${t('Aclaración')}">
          <div class="ob-edit-actions">
            <button type="button" class="primary small" data-save="${i}">${t('Guardar')}</button>
            <button type="button" class="ghost small" data-cancel>${t('Cancelar')}</button>
          </div>
        </div>
      </div>` : `
      <div class="ob-item">
        <span class="ob-num">${i + 1}</span>
        <div class="ob-text"><span class="t">${escapeHtml(it.label)}</span>${it.hint ? `<span class="h">${escapeHtml(it.hint)}</span>` : ''}</div>
        <div class="ob-actions">
          <button type="button" class="ob-icon" data-edit="${i}" aria-label="${t('Editar regla')}" title="${t('Editar')}">${Icons.svg('pencil', 15)}</button>
          <button type="button" class="ob-icon danger" data-del="${i}" aria-label="${t('Eliminar regla')}" title="${t('Eliminar')}">${Icons.svg('x', 15)}</button>
        </div>
      </div>`).join('');
    $('obItems').querySelectorAll('[data-edit]').forEach(b=> b.addEventListener('click', ()=>{ editing = Number(b.dataset.edit); renderItems(); $('obItems').querySelector('.ob-edit-label').focus(); }));
    $('obItems').querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', ()=>{ draft.items.splice(Number(b.dataset.del), 1); editing = null; renderItems(); }));
    $('obItems').querySelectorAll('[data-cancel]').forEach(b=> b.addEventListener('click', ()=>{ editing = null; renderItems(); }));
    $('obItems').querySelectorAll('[data-save]').forEach(b=> b.addEventListener('click', ()=>{
      const row = b.closest('.ob-item');
      const label = row.querySelector('.ob-edit-label').value.trim();
      if(!label) return;
      Object.assign(draft.items[Number(b.dataset.save)], {label, hint: row.querySelector('.ob-edit-hint').value.trim()});
      editing = null;
      renderItems();
    }));
  }

  function renderRuleCount(){
    const n = draft.items.length;
    const box = $('obRuleCount');
    box.textContent = n >= MIN_RULES
      ? '✓ ' + t('{n} reglas cargadas', {n})
      : t('{n} de {min} reglas mínimas', {n, min: MIN_RULES});
    box.classList.toggle('ok', n >= MIN_RULES);
    if(n >= MIN_RULES) $('obItemsError').textContent = '';
  }

  function renderCriteria(){
    const box = $('obCrit');
    box.innerHTML = draft.setup.criteria.length ? draft.setup.criteria.map((c, i)=> `<div class="ob-item">
        <span class="ob-num">${i + 1}</span>
        <div class="ob-text"><span class="t">${escapeHtml(c)}</span></div>
        <div class="ob-actions"><button type="button" class="ob-icon danger" data-del-crit="${i}" aria-label="${t('Quitar criterio')}" title="${t('Quitar')}">${Icons.svg('x', 15)}</button></div>
      </div>`).join('') : `<div class="ob-empty">${t('Sumá lo que tiene que pasar para que tomes este setup (ej. "Barrida de liquidez en zona de 4H").')}</div>`;
    box.querySelectorAll('[data-del-crit]').forEach(b=> b.addEventListener('click', ()=>{ draft.setup.criteria.splice(Number(b.dataset.delCrit), 1); renderCriteria(); }));
  }

  function addCriterion(){
    const v = $('obNewCrit').value.trim();
    if(!v){ $('obNewCrit').focus(); return; }
    if(draft.setup.criteria.length >= MAX_CRITERIA){ $('obSetupError').textContent = t('Podés cargar hasta 15 criterios.'); return; }
    draft.setup.criteria.push(v.slice(0, 200));
    $('obNewCrit').value = '';
    $('obSetupError').textContent = '';
    renderCriteria();
    $('obNewCrit').focus();
  }
  $('obAddCrit').addEventListener('click', addCriterion);
  $('obNewCrit').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); addCriterion(); } });
  $('obSetupName').addEventListener('input', ()=>{ draft.setup.name = $('obSetupName').value; $('obSetupError').textContent = ''; });
  $('obSetupDesc').addEventListener('input', ()=>{ draft.setup.description = $('obSetupDesc').value; });

  function render(){
    document.querySelectorAll('.ob-step').forEach(s=> s.style.display = Number(s.dataset.step) === step ? '' : 'none');
    $('obSteps').querySelectorAll('span').forEach((d, i)=> d.classList.toggle('done', i < step));
    document.querySelectorAll('.ob-choice').forEach(b=> b.classList.toggle('active', b.dataset.type === draft.accountType));
    $('obFunded').style.display = draft.accountType === 'funded' ? '' : 'none';
    document.querySelectorAll('#obDdType .pill').forEach(b=> b.classList.toggle('active', b.dataset.dd === draft.ddType));
    const risk = num($('obRisk').value);
    document.querySelectorAll('#obRiskQuick .pill').forEach(b=> b.classList.toggle('active', risk !== null && Number(b.dataset.risk) === risk));
    $('obBack').style.visibility = step === 1 ? 'hidden' : 'visible';
    $('obNext').textContent = step === LAST ? t('Empezar a operar') : t('Siguiente');
    $('obError').textContent = '';
  }

  document.querySelectorAll('.ob-choice').forEach(b=> b.addEventListener('click', ()=>{ draft.accountType = b.dataset.type; render(); }));
  document.querySelectorAll('#obDdType .pill').forEach(b=> b.addEventListener('click', ()=>{ draft.ddType = b.dataset.dd; render(); }));
  document.querySelectorAll('#obRiskQuick .pill').forEach(b=> b.addEventListener('click', ()=>{ $('obRisk').value = b.dataset.risk; render(); }));
  $('obRisk').addEventListener('input', render);

  function addItem(){
    const label = $('obNewItem').value.trim();
    if(!label){ $('obNewItem').focus(); return; }
    draft.items.push({id: genItemId(), label, hint: $('obNewHint').value.trim()});
    $('obNewItem').value = '';
    $('obNewHint').value = '';
    $('obItemsError').textContent = '';
    renderItems();
    $('obNewItem').focus();
  }
  $('obAddItem').addEventListener('click', addItem);
  ['obNewItem', 'obNewHint'].forEach(id=> $(id).addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); addItem(); } }));

  function close(){
    JournalAuth.completeOnboarding();
    $('onboarding').style.display = 'none';
  }

  function finish(){
    const risk = $('obRisk').value.trim();
    if(risk !== '' && (num(risk) === null || num(risk) <= 0 || num(risk) > 100)){
      $('obError').textContent = t('Ingresá un número mayor a 0 y hasta 100 (ej. 1).');
      return;
    }
    if(draft.accountType === 'funded'){
      const bad = ['obDaily', 'obTotal', 'obTarget'].find(id=>{ const v = $(id).value.trim(); return v !== '' && (num(v) === null || num(v) <= 0 || num(v) > 100); });
      if(bad){
        $('obError').textContent = t('Revisá las reglas de tu prop firm (paso 1): tienen que ser números entre 0 y 100 (ej. 5).');
        return;
      }
    }
    state.items = draft.items.map(it=> ({id: it.id, label: it.label, hint: it.hint || '', createdAt: Date.now()}));
    // El primer setup queda como ficha en la pestaña Plan, igual que los que se cargan desde ahí.
    const name = draft.setup.name.trim().slice(0, 60);
    const key = name.toLowerCase();
    const prev = state.playbook.find(p=> String(p.name || '').trim().toLowerCase() === key);
    const setup = {name, description: draft.setup.description.trim().slice(0, 2000), criteria: draft.setup.criteria.slice()};
    if(prev) Object.assign(prev, setup);
    else state.playbook.push({id: 'pb_' + Date.now() + '_' + Math.floor(Math.random() * 1e4), createdAt: Date.now(), archived: false, imageId: null, image: null, ...setup});
    // La primera cuenta toma el tipo y las reglas elegidas acá; después se suman más en Ajustes.
    const acc = state.accounts[0];
    if(draft.accountType === 'funded'){
      const target = $('obTarget').value.trim();
      Object.assign(acc, {type: target ? 'challenge' : 'funded', name: acc.name === t('Mi cuenta') ? t('Cuenta de fondeo') : acc.name});
      Object.assign(acc.rules, {dailyDrawdown: $('obDaily').value.trim(), totalDrawdown: $('obTotal').value.trim(), profitTarget: target, ddType: draft.ddType});
    } else {
      acc.type = 'personal';
    }
    state.maxDailyRisk = risk;
    saveState();

    $('maxDailyRiskInput').value = state.maxDailyRisk || '';
    renderAccounts();
    renderItemsManager();
    renderChecklist();
    updateAddButton();
    renderAll();
    close();
  }

  $('obNext').addEventListener('click', ()=>{
    // Si escribió una regla y no tocó "Agregar", la sumamos igual.
    if(step === 2 && $('obNewItem').value.trim()) addItem();
    if(step === 2 && draft.items.length < MIN_RULES){
      $('obItemsError').textContent = t('Agregá al menos {n} reglas a tu Trading Plan para seguir.', {n: MIN_RULES});
      $('obNewItem').focus();
      return;
    }
    if(step === 3){
      if($('obNewCrit').value.trim()) addCriterion();
      if(!draft.setup.name.trim()){
        $('obSetupError').textContent = t('Poné un nombre al setup.');
        $('obSetupName').focus();
        return;
      }
      if(!draft.setup.criteria.length){
        $('obSetupError').textContent = t('Agregá al menos un criterio de entrada a tu setup.');
        $('obNewCrit').focus();
        return;
      }
    }
    if(step < LAST){ step++; render(); } else finish();
  });
  $('obBack').addEventListener('click', ()=>{ if(step > 1){ step--; render(); } });

  renderItems();
  renderCriteria();
  render();
  window.openOnboarding = ()=>{ $('onboarding').style.display = 'flex'; };
  // Si la prueba ya venció manda el paywall; la configuración queda para después.
  if(JournalAuth.hasAccess(user)) openOnboarding();
})();
