// Idiomas.
//
// El español es el texto original y está escrito directo en el código y en el
// HTML. Los otros idiomas traducen ese texto con un diccionario
// (js/lang-en.js): t('Registrar trade') → 'Log trade'. Si una frase no está en
// el diccionario se muestra en español y queda anotada en I18N_MISSING.
//
//   t('Te quedan {n} días.', {n: 3})       variables entre llaves
//   tp(n, '{n} trade', '{n} trades')       singular / plural (n se pasa solo)
//
// El HTML fijo se traduce entero al cargar la página (translateDom): textos,
// placeholder, title, aria-label y data-title. Cambiar de idioma recarga la
// página, así todos los formateadores de fecha se arman de nuevo.

const LANGS = {
  es: {label: 'Español', locale: 'es-AR'},
  en: {label: 'English', locale: 'en-US'},
};
const LANG_KEY = 'jt_lang';
// Mientras la traducción no esté completa, el inglés se elige a mano:
// no se activa solo por el idioma del navegador.
const LANG_AUTO_DETECT = false;

function detectLang(){
  try{
    const saved = localStorage.getItem(LANG_KEY);
    if(LANGS[saved]) return saved;
  }catch(e){}
  if(LANG_AUTO_DETECT){
    const nav = (navigator.languages || [navigator.language || ''])[0] || '';
    if(!/^es\b/i.test(nav)) return 'en';
  }
  return 'es';
}
const LANG = detectLang();
const LOCALE = LANGS[LANG].locale;
const I18N = {en: typeof I18N_EN !== 'undefined' ? I18N_EN : {}};
const I18N_MISSING = new Set();
document.documentElement.lang = LANG;

const normKey = s=> s.replace(/\s+/g, ' ').trim();

function t(s, vars){
  let out = s;
  if(LANG !== 'es'){
    const tr = I18N[LANG][s];
    if(tr === undefined) I18N_MISSING.add(s); else out = tr;
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k)=> k in vars ? vars[k] : m) : out;
}
function tp(n, one, other, vars){
  return t(n === 1 ? one : other, {n, ...vars});
}

function setLang(lang){
  if(!LANGS[lang] || lang === LANG) return;
  try{ localStorage.setItem(LANG_KEY, lang); }catch(e){}
  location.reload();
}

// Traduce el HTML fijo de la página. Las frases con formato adentro (<b>, <a>)
// se marcan con data-i18n-html y se traducen enteras.
const I18N_ATTRS = ['placeholder', 'title', 'aria-label', 'data-title', 'alt'];
function translateDom(root = document){
  if(LANG === 'es') return;
  const dict = I18N[LANG];
  const lookup = s=>{
    const k = normKey(s);
    if(!k || !/[A-Za-zÁÉÍÓÚáéíóúñÑ¿¡]/.test(k)) return null;
    if(dict[k] === undefined){ I18N_MISSING.add(k); return null; }
    return dict[k];
  };
  const base = root.body || root;
  base.querySelectorAll('[data-i18n-html]').forEach(el=>{
    const tr = lookup(el.innerHTML);
    if(tr !== null) el.innerHTML = tr;
    el.dataset.i18nDone = '1';
  });
  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
    acceptNode: n=> n.parentElement.closest('script, style, [data-i18n-done], [data-no-i18n]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n=>{
    const tr = lookup(n.nodeValue);
    if(tr !== null) n.nodeValue = n.nodeValue.replace(/^(\s*)[\s\S]*?(\s*)$/, (m, a, b)=> a + tr + b);
  });
  base.querySelectorAll('*').forEach(el=>{
    if(el.closest('[data-no-i18n]')) return;
    I18N_ATTRS.forEach(a=>{
      const v = el.getAttribute(a);
      if(v === null) return;
      const tr = lookup(v);
      if(tr !== null) el.setAttribute(a, tr);
    });
  });
  if(root === document){
    const tt = lookup(document.title);
    if(tt !== null) document.title = tt;
    document.querySelectorAll('head meta[content]').forEach(m=>{
      if(!/description|og:title|og:description|twitter/.test(m.getAttribute('name') || m.getAttribute('property') || '')) return;
      const tr = lookup(m.getAttribute('content'));
      if(tr !== null) m.setAttribute('content', tr);
    });
  }
}
