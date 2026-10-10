// App instalable (PWA): registra el service worker (sw.js), avisa cuando hay
// una versión nueva, ofrece instalar la app y muestra cuando no hay conexión.
// Se carga con defer en todas las páginas, después de i18n.js.
(function(){
  const standalone = ()=> window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = ()=> /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installEvent = null;

  // ---- Barra de avisos (abajo, sobre la barra de pestañas en celular) ----
  function notice(id, html, tone){
    let el = document.getElementById(id);
    if(!html){ if(el) el.remove(); return null; }
    if(!el){
      el = document.createElement('div');
      el.id = id;
      el.className = 'pwa-notice ' + (tone || '');
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    return el;
  }

  // ---- Service worker y actualizaciones ----
  // Solo en https o localhost (en file:// no hay service worker).
  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', ()=>{
      if(reloading) return;
      reloading = true;
      location.reload();
    });
    const offerUpdate = worker=>{
      const el = notice('pwaUpdate', `<span>${t('Hay una versión nueva de la app.')}</span><button type="button" class="primary small">${t('Actualizar')}</button>`, 'info');
      el.querySelector('button').addEventListener('click', ()=> worker.postMessage('skipWaiting'));
    };
    navigator.serviceWorker.register('sw.js').then(reg=>{
      // Una versión nueva ya descargada, esperando: solo si ya había una app funcionando.
      if(reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', ()=>{
        const w = reg.installing;
        if(!w) return;
        w.addEventListener('statechange', ()=>{
          if(w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
      // Si la app queda abierta mucho tiempo, se fija cada hora si hay versión nueva.
      setInterval(()=> reg.update().catch(()=>{}), 60 * 60 * 1000);
    }).catch(e=> console.warn('Service worker no registrado', e));
  }

  // ---- Instalar ----
  window.addEventListener('beforeinstallprompt', e=>{
    e.preventDefault();
    installEvent = e;
    document.dispatchEvent(new Event('pwa-change'));
  });
  window.addEventListener('appinstalled', ()=>{
    installEvent = null;
    document.dispatchEvent(new Event('pwa-change'));
  });

  window.JournalPWA = {
    standalone, isIOS,
    // 'installed' | 'prompt' (Chrome, Edge, Android) | 'ios' (instrucciones) | 'none'
    state(){
      if(standalone()) return 'installed';
      if(installEvent) return 'prompt';
      if(isIOS()) return 'ios';
      return 'none';
    },
    async install(){
      if(!installEvent) return false;
      installEvent.prompt();
      const choice = await installEvent.userChoice.catch(()=> null);
      installEvent = null;
      document.dispatchEvent(new Event('pwa-change'));
      return !!(choice && choice.outcome === 'accepted');
    },
  };

  // Botones "Instalar app" de las páginas: [data-pwa-install] se muestra solo si se puede.
  function renderInstallButtons(){
    const st = JournalPWA.state();
    document.querySelectorAll('[data-pwa-install]').forEach(b=>{ b.hidden = st !== 'prompt'; });
  }
  document.addEventListener('click', e=>{ if(e.target.closest('[data-pwa-install]')) JournalPWA.install(); });
  document.addEventListener('pwa-change', renderInstallButtons);

  // ---- Sin conexión (solo dentro de la app, que funciona igual offline) ----
  function renderOnline(){
    if(!document.querySelector('.appshell')) return;
    notice('pwaOffline', navigator.onLine ? '' : `<span>${t('Sin conexión. Podés seguir usando el journal: tus datos se guardan en este dispositivo.')}</span>`, 'warn');
  }
  window.addEventListener('online', renderOnline);
  window.addEventListener('offline', renderOnline);

  // ---- Color de la barra del sistema según el modo claro/oscuro ----
  function syncThemeColor(){
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#161615');
  }
  new MutationObserver(syncThemeColor).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});

  // Atajo del ícono instalado: app.html#register abre esa pestaña.
  function openHashTab(){
    const tab = location.hash.slice(1);
    if(tab && typeof showTab === 'function' && document.querySelector(`.tabbtn[data-tab="${tab}"]`)) showTab(tab);
  }

  // defer: el HTML ya está cargado, pero los scripts del final del body corren después.
  window.addEventListener('DOMContentLoaded', ()=>{
    renderInstallButtons();
    renderOnline();
    syncThemeColor();
    openHashTab();
  });
})();
