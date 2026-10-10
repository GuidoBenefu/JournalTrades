// Service worker: guarda la app para que abra rápido y funcione sin conexión.
//
// Los datos del journal ya viven en el navegador (localStorage e IndexedDB), así
// que alcanza con tener los archivos de la app en caché.
// - Páginas: primero la red (para tener siempre la última versión) y, si no hay
//   conexión, la copia guardada.
// - CSS, JS e imágenes: primero la caché. Los CSS y JS llevan ?v=N en la URL,
//   así que una versión nueva nunca se confunde con la vieja.
//
// Al publicar cambios, subir VERSION junto con el ?v= de los .html (ver README).
const VERSION = 46;
const CACHE = 'jt-v' + VERSION;
const v = '?v=' + VERSION;
const JS = ['lang-en', 'i18n', 'theme', 'auth', 'icons', 'storage', 'time', 'images', 'session', 'app', 'accounts',
  'analytics', 'charts', 'achievements', 'dashboard', 'analysis', 'review', 'calendar', 'onboarding', 'settings',
  'history', 'playbook', 'share', 'report', 'importer', 'pwa'];
const PRECACHE = [
  './', 'index.html', 'app.html', 'auth.html', 'terminos.html', 'privacidad.html', 'manifest.webmanifest',
  'css/styles.css' + v, 'css/site.css' + v,
  ...JS.map(f=> 'js/' + f + '.js' + v),
  'img/logo.png', 'img/favicon.png', 'img/apple-touch-icon.png', 'img/icon-192.png', 'img/icon-512.png',
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(PRECACHE)));
});

self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys()
    .then(keys=> Promise.all(keys.filter(k=> k.startsWith('jt-v') && k !== CACHE).map(k=> caches.delete(k))))
    .then(()=> self.clients.claim()));
});

// La página pide activar la versión nueva cuando el usuario toca "Actualizar".
self.addEventListener('message', e=>{
  if(e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;

  if(req.mode === 'navigate'){
    e.respondWith(
      fetch(req).then(res=>{
        if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(url.pathname, copy)); }
        return res;
      }).catch(()=> caches.match(url.pathname, {ignoreSearch: true})
        .then(r=> r || caches.match('app.html'))
        .then(r=> r || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit=> hit || fetch(req).then(res=>{
      if(res.ok && res.type === 'basic'){ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)); }
      return res;
    }))
  );
});
