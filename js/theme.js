// Modo claro / oscuro. Por defecto la web se ve en oscuro; la elección del
// usuario se guarda en localStorage. Se carga en el <head> para aplicar el tema
// antes de pintar la página y evitar un parpadeo.
(function(){
  const KEY = 'jt_theme';
  const ICONS = {
    // Se muestra el ícono del modo al que se va a cambiar.
    light: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  };

  function stored(){
    try{ return localStorage.getItem(KEY); }catch(e){ return null; }
  }

  function current(){
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function renderToggles(){
    const next = current() === 'dark' ? 'light' : 'dark';
    const tr = typeof t === 'function' ? t : s=> s;
    const label = next === 'light' ? tr('Cambiar a modo claro') : tr('Cambiar a modo oscuro');
    document.querySelectorAll('[data-theme-toggle]').forEach(btn=>{
      btn.innerHTML = ICONS[next];
      btn.setAttribute('aria-label', label);
      btn.title = label;
    });
  }

  function set(theme){
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    try{ localStorage.setItem(KEY, current()); }catch(e){}
    renderToggles();
  }

  document.documentElement.setAttribute('data-theme', stored() === 'light' ? 'light' : 'dark');

  document.addEventListener('DOMContentLoaded', ()=>{
    renderToggles();
    document.querySelectorAll('[data-theme-toggle]').forEach(btn=>{
      btn.addEventListener('click', ()=> set(current() === 'dark' ? 'light' : 'dark'));
    });
  });

  window.JournalTheme = {current, set};
})();
