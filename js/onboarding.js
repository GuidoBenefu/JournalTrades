// Configuración guiada para cuentas nuevas: tipo de cuenta, Trading Plan y riesgo
// máximo diario. Usa el estado y las funciones de render de app.js.
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
  };
  const MIN_RULES = 2;
  let editing = null;

  function renderItems(){
    renderRuleCount();
    if(!draft.items.length){
      $('obItems').innerHTML = '<div class="ob-empty">Todavía no agregaste reglas. Empezá por la más importante de tu estrategia.</div>';
      return;
    }
    $('obItems').innerHTML = draft.items.map((it, i)=> editing === i ? `
      <div class="ob-item editing">
        <span class="ob-num">${i + 1}</span>
        <div class="ob-edit">
          <input type="text" class="ob-edit-label" value="${escapeHtml(it.label)}" aria-label="Regla">
          <input type="text" class="ob-edit-hint" value="${escapeHtml(it.hint || '')}" placeholder="Aclaración (opcional)" aria-label="Aclaración">
          <div class="ob-edit-actions">
            <button type="button" class="primary small" data-save="${i}">Guardar</button>
            <button type="button" class="ghost small" data-cancel>Cancelar</button>
          </div>
        </div>
      </div>` : `
      <div class="ob-item">
        <span class="ob-num">${i + 1}</span>
        <div class="ob-text"><span class="t">${escapeHtml(it.label)}</span>${it.hint ? `<span class="h">${escapeHtml(it.hint)}</span>` : ''}</div>
        <div class="ob-actions">
          <button type="button" class="ob-icon" data-edit="${i}" aria-label="Editar regla" title="Editar">${Icons.svg('pencil', 15)}</button>
          <button type="button" class="ob-icon danger" data-del="${i}" aria-label="Eliminar regla" title="Eliminar">${Icons.svg('x', 15)}</button>
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
      ? `✓ ${n} reglas cargadas`
      : `${n} de ${MIN_RULES} reglas mínimas`;
    box.classList.toggle('ok', n >= MIN_RULES);
    if(n >= MIN_RULES) $('obItemsError').textContent = '';
  }

  function render(){
    document.querySelectorAll('.ob-step').forEach(s=> s.style.display = Number(s.dataset.step) === step ? '' : 'none');
    $('obSteps').querySelectorAll('span').forEach((d, i)=> d.classList.toggle('done', i < step));
    document.querySelectorAll('.ob-choice').forEach(b=> b.classList.toggle('active', b.dataset.type === draft.accountType));
    $('obFunded').style.display = draft.accountType === 'funded' ? '' : 'none';
    document.querySelectorAll('#obDdType .pill').forEach(b=> b.classList.toggle('active', b.dataset.dd === draft.ddType));
    const risk = num($('obRisk').value);
    document.querySelectorAll('#obRiskQuick .pill').forEach(b=> b.classList.toggle('active', risk !== null && Number(b.dataset.risk) === risk));
    $('obBack').style.visibility = step === 1 ? 'hidden' : 'visible';
    $('obNext').textContent = step === 3 ? 'Empezar a operar' : 'Siguiente';
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
      $('obError').textContent = 'Ingresá un número mayor a 0 y hasta 100 (ej. 1).';
      return;
    }
    if(draft.accountType === 'funded'){
      const bad = ['obDaily', 'obTotal', 'obTarget'].find(id=>{ const v = $(id).value.trim(); return v !== '' && (num(v) === null || num(v) <= 0 || num(v) > 100); });
      if(bad){
        $('obError').textContent = 'Revisá las reglas de tu prop firm (paso 1): tienen que ser números entre 0 y 100 (ej. 5).';
        return;
      }
    }
    state.items = draft.items.map(it=> ({id: it.id, label: it.label, hint: it.hint || '', createdAt: Date.now()}));
    // La primera cuenta toma el tipo y las reglas elegidas acá; después se suman más en Ajustes.
    const acc = state.accounts[0];
    if(draft.accountType === 'funded'){
      const target = $('obTarget').value.trim();
      Object.assign(acc, {type: target ? 'challenge' : 'funded', name: acc.name === 'Mi cuenta' ? 'Cuenta de fondeo' : acc.name});
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
      $('obItemsError').textContent = `Agregá al menos ${MIN_RULES} reglas a tu Trading Plan para seguir.`;
      $('obNewItem').focus();
      return;
    }
    if(step < 3){ step++; render(); } else finish();
  });
  $('obBack').addEventListener('click', ()=>{ if(step > 1){ step--; render(); } });

  renderItems();
  render();
  window.openOnboarding = ()=>{ $('onboarding').style.display = 'flex'; };
  // Si la prueba ya venció manda el paywall; la configuración queda para después.
  if(JournalAuth.hasAccess(user)) openOnboarding();
})();
