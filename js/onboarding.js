// Configuración guiada para cuentas nuevas: tipo de cuenta, checklist y riesgo
// máximo diario. Usa el estado y las funciones de render de app.js.
(function(){
  const user = JournalAuth.currentUser();
  if(!JournalAuth.needsOnboarding(user)) return;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num = v => {
    const n = parseFloat(String(v || '').replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  let step = 1;
  const draft = {
    accountType: state.accountType || 'retail',
    ddType: (state.fundedRules && state.fundedRules.ddType) || 'static',
    items: state.items.map(it => ({...it, keep: true})),
  };

  function renderItems(){
    $('obItems').innerHTML = draft.items.map((it, i)=>`
      <label class="ob-item">
        <input type="checkbox" data-i="${i}" ${it.keep ? 'checked' : ''}>
        <span><span class="t">${esc(it.label)}</span>${it.hint ? `<span class="h">${esc(it.hint)}</span>` : ''}</span>
      </label>`).join('');
    $('obItems').querySelectorAll('input').forEach(cb=>{
      cb.addEventListener('change', ()=>{ draft.items[cb.dataset.i].keep = cb.checked; });
    });
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
    if(!label) return;
    draft.items.push({id: genItemId(), label, hint: '', keep: true});
    $('obNewItem').value = '';
    renderItems();
  }
  $('obAddItem').addEventListener('click', addItem);
  $('obNewItem').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); addItem(); } });

  function close(){
    JournalAuth.completeOnboarding();
    $('onboarding').style.display = 'none';
  }

  function finish(){
    const risk = $('obRisk').value.trim();
    if(risk !== '' && (num(risk) === null || num(risk) <= 0)){
      $('obError').textContent = 'Ingresá un número mayor a 0 (ej. 1).';
      return;
    }
    const kept = draft.items.filter(it=> it.keep).map(({keep, ...it})=> it);
    if(kept.length) state.items = kept;
    state.accountType = draft.accountType;
    if(draft.accountType === 'funded'){
      Object.assign(state.fundedRules, {
        dailyDrawdown: $('obDaily').value.trim(),
        totalDrawdown: $('obTotal').value.trim(),
        profitTarget: $('obTarget').value.trim(),
        ddType: draft.ddType,
      });
    }
    state.maxDailyRisk = risk;
    saveState();

    $('maxDailyRiskInput').value = state.maxDailyRisk || '';
    renderAccountTypePills();
    renderItemsManager();
    renderChecklist();
    updateAddButton();
    renderHistory();
    renderItemStats();
    renderFundedProgress();
    close();
  }

  $('obNext').addEventListener('click', ()=>{
    if(step === 2 && !draft.items.some(it=> it.keep)){
      alert('Dejá al menos una regla en tu checklist.');
      return;
    }
    if(step < 3){ step++; render(); } else finish();
  });
  $('obBack').addEventListener('click', ()=>{ if(step > 1){ step--; render(); } });
  $('obSkip').addEventListener('click', close);

  renderItems();
  render();
  // Si la prueba ya venció manda el paywall; la configuración queda para después.
  if(JournalAuth.hasAccess(user)) $('onboarding').style.display = 'flex';
})();
