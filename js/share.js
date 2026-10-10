// Tarjetas para compartir: una imagen PNG (1080x1350, sirve para Instagram,
// X y WhatsApp) de un trade o de un mes, dibujada en un canvas. Nunca muestra
// montos en dinero: el resultado va en %, en R o se oculta.

const SHARE_W = 1080, SHARE_H = 1350;
const SC = {bg: '#161615', bg2: '#0c2a1c', card: 'rgba(255,255,255,0.05)', line: 'rgba(255,255,255,0.12)',
  text: '#f2f1ec', text2: '#b9b7ae', text3: '#86847b', brand: '#10e88c', danger: '#f09595', amber: '#ef9f27'};
const SHARE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

let shareLogo = null;
function loadShareLogo(){
  if(shareLogo) return Promise.resolve(shareLogo);
  return new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>{ shareLogo = img; resolve(img); };
    img.onerror = ()=> resolve(null);
    img.src = 'img/logo.png';
  });
}

// ---- Primitivas de dibujo ----
function sFont(ctx, size, weight = 700){ ctx.font = `${weight} ${size}px ${SHARE_FONT}`; }
function sText(ctx, txt, x, y, {size = 40, weight = 700, color = SC.text, align = 'left', maxW} = {}){
  sFont(ctx, size, weight);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  // Si no entra, se achica la letra hasta que entre.
  if(maxW){ let s = size; while(s > 18 && ctx.measureText(txt).width > maxW){ s -= 2; sFont(ctx, s, weight); } }
  ctx.fillText(txt, x, y);
}
function sRound(ctx, x, y, w, h, r, fill, stroke){
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  if(fill){ ctx.fillStyle = fill; ctx.fill(); }
  if(stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}
function sBackground(ctx){
  const g = ctx.createLinearGradient(0, 0, SHARE_W, SHARE_H);
  g.addColorStop(0, SC.bg2); g.addColorStop(0.55, SC.bg); g.addColorStop(1, SC.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  // Brillo verde arriba a la izquierda.
  const r = ctx.createRadialGradient(140, 120, 0, 140, 120, 700);
  r.addColorStop(0, 'rgba(16,232,140,0.18)'); r.addColorStop(1, 'rgba(16,232,140,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, SHARE_W, SHARE_H);
}
function sHeader(ctx, kicker){
  if(shareLogo){ const h = 92, w = h * shareLogo.width / shareLogo.height; ctx.drawImage(shareLogo, 80, 74, w, h); }
  sText(ctx, kicker.toUpperCase(), SHARE_W - 80, 132, {size: 30, weight: 700, color: SC.brand, align: 'right'});
}
function sFooter(ctx){
  ctx.fillStyle = SC.line; ctx.fillRect(80, SHARE_H - 150, SHARE_W - 160, 2);
  sText(ctx, t('Operá con un plan. Ejecutá con disciplina.'), 80, SHARE_H - 88, {size: 32, weight: 600, color: SC.text2, maxW: 700});
  sText(ctx, 'Journal Trading', SHARE_W - 80, SHARE_H - 88, {size: 32, weight: 800, color: SC.brand, align: 'right'});
}
// Fila de cuadros con un dato grande y su etiqueta.
function sStatRow(ctx, y, items, h = 170){
  const gap = 24, w = (SHARE_W - 160 - gap * (items.length - 1)) / items.length;
  items.forEach((it, i)=>{
    const x = 80 + i * (w + gap);
    sRound(ctx, x, y, w, h, 28, SC.card, SC.line);
    sText(ctx, it.value, x + w / 2, y + h / 2 + 18, {size: it.size || 58, weight: 800, color: it.color || SC.text, align: 'center', maxW: w - 40});
    sText(ctx, it.label.toUpperCase(), x + w / 2, y + h - 30, {size: 22, weight: 700, color: SC.text3, align: 'center', maxW: w - 30});
  });
}
const sColor = v=> v > 0.05 ? SC.brand : v < -0.05 ? SC.danger : SC.text;

// ---- Tarjeta de un trade ----
function drawTradeCard(ctx, h, opts){
  sBackground(ctx);
  sHeader(ctx, t('Trade'));
  const date = keyDate(dayKeyFromTs(h.ts)).toLocaleDateString(LOCALE, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
  sText(ctx, capFirst(date) + ' · ' + sessionOf(h.ts), 80, 300, {size: 32, weight: 600, color: SC.text2, maxW: SHARE_W - 160});
  // Activo y dirección.
  const asset = h.asset || t('Trade');
  sText(ctx, asset, 80, 420, {size: 110, weight: 800, maxW: 620});
  sFont(ctx, 110, 800);
  const aw = Math.min(ctx.measureText(asset).width, 620);
  if(h.direction){
    const label = (h.direction === 'long' ? '▲ ' + t('Long') : '▼ ' + t('Short')).toUpperCase();
    const col = h.direction === 'long' ? SC.brand : SC.danger;
    sFont(ctx, 30, 800); const pw = ctx.measureText(label).width + 44;
    sRound(ctx, 80 + aw + 30, 360, pw, 60, 30, h.direction === 'long' ? 'rgba(16,232,140,0.15)' : 'rgba(240,149,149,0.15)');
    sText(ctx, label, 80 + aw + 30 + pw / 2, 401, {size: 30, weight: 800, color: col, align: 'center'});
  }
  if(h.setup) sText(ctx, h.setup, 80, 485, {size: 36, weight: 600, color: SC.text2, maxW: SHARE_W - 160});
  // Resultado.
  const r = realR(h);
  const res = opts.result === 'pct' && h.resultPct !== null && h.resultPct !== undefined ? fmtSignedPct(h.resultPct)
    : opts.result === 'r' && r !== null ? (r > 0 ? '+' : '') + r.toFixed(1) + 'R'
    : RESULT_LABELS[h.result] || '';
  const resVal = opts.result === 'pct' ? h.resultPct : opts.result === 'r' ? r : (h.result === 'win' ? 1 : h.result === 'loss' ? -1 : 0);
  sRound(ctx, 80, 560, SHARE_W - 160, 300, 36, SC.card, SC.line);
  sText(ctx, t('Resultado').toUpperCase(), SHARE_W / 2, 630, {size: 26, weight: 700, color: SC.text3, align: 'center'});
  sText(ctx, res, SHARE_W / 2, 790, {size: opts.result === 'none' ? 110 : 170, weight: 800, color: sColor(resVal || 0), align: 'center', maxW: SHARE_W - 220});
  // Disciplina.
  const emo = emotionById(h.emotion);
  sStatRow(ctx, 900, [
    {value: h.followedPlan ? '✓' : '✗', label: h.followedPlan ? t('Plan respetado') : t('Plan roto'), color: h.followedPlan ? SC.brand : SC.danger, size: 76},
    {value: typeof h.score === 'number' ? h.score + '' : '—', label: t('Disciplina'), color: typeof h.score === 'number' ? (h.score >= 80 ? SC.brand : h.score >= 50 ? SC.amber : SC.danger) : SC.text},
    {value: emo ? emo.label : '—', label: t('Emoción'), size: 46},
  ]);
  sFooter(ctx);
}

// ---- Tarjeta de un mes ----
function monthTrades(monthKey){
  return viewTrades().filter(h=> monthKeyOf(h.ts) === monthKey);
}
function drawMonthCard(ctx, monthKey, opts){
  const list = Analytics.chronological(monthTrades(monthKey));
  const s = Analytics.summary(list);
  sBackground(ctx);
  sHeader(ctx, t('Mi mes'));
  const label = capFirst(keyDate(monthKey + '-15').toLocaleDateString(LOCALE, {month: 'long', year: 'numeric'}));
  sText(ctx, label, 80, 330, {size: 96, weight: 800, maxW: SHARE_W - 160});
  // Anillo de plan seguido.
  const cx = 290, cy = 600, R = 165, goal = goalPct();
  ctx.lineWidth = 34; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = s.planPct >= goal ? SC.brand : SC.amber;
  ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.planPct / 100)); ctx.stroke();
  sText(ctx, Math.round(s.planPct) + '%', cx, cy + 22, {size: 96, weight: 800, align: 'center'});
  sText(ctx, t('plan respetado').toUpperCase(), cx, cy + 70, {size: 22, weight: 700, color: SC.text3, align: 'center'});
  // Datos a la derecha.
  const rows = [[t('Trades'), String(s.n), SC.text], [t('Win rate'), Math.round(s.winRate) + '%', SC.text]];
  if(opts.result !== 'none') rows.unshift([t('Resultado'), fmtSignedPct(s.sum), sColor(s.sum)]);
  const best = list.reduce((a, h)=>{ a.run = h.followedPlan ? a.run + 1 : 0; a.max = Math.max(a.max, a.run); return a; }, {run: 0, max: 0}).max;
  rows.push([t('Mejor racha'), String(best), SC.text]);
  const top = 600 - (rows.length * 92) / 2;
  rows.forEach(([l, v, c], i)=>{
    const y = top + i * 92;
    sText(ctx, l.toUpperCase(), 540, y + 30, {size: 24, weight: 700, color: SC.text3});
    sText(ctx, v, SHARE_W - 80, y + 40, {size: 56, weight: 800, color: c, align: 'right'});
  });
  // Curva del mes (o la curva de disciplina si el resultado está oculto).
  const box = {x: 80, y: 860, w: SHARE_W - 160, h: 300};
  sRound(ctx, box.x, box.y, box.w, box.h, 36, SC.card, SC.line);
  let vals;
  if(opts.result === 'none'){ let p = 0; vals = [0].concat(list.map((h, i)=> (p += h.followedPlan ? 1 : 0) / (i + 1) * 100)); }
  else { let a = 0; vals = [0].concat(list.map(h=> a += Analytics.pct(h))); }
  sText(ctx, (opts.result === 'none' ? t('Plan seguido') : t('Curva de resultados')).toUpperCase(), box.x + 36, box.y + 56, {size: 22, weight: 700, color: SC.text3});
  if(vals.length > 1){
    const min = Math.min(...vals, 0), max = Math.max(...vals, opts.result === 'none' ? 100 : 0.5);
    const px = i=> box.x + 40 + i * (box.w - 80) / (vals.length - 1);
    const py = v=> box.y + box.h - 40 - (v - min) * (box.h - 120) / (max - min || 1);
    ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.strokeStyle = SC.brand;
    ctx.beginPath(); vals.forEach((v, i)=> i ? ctx.lineTo(px(i), py(v)) : ctx.moveTo(px(i), py(v))); ctx.stroke();
    ctx.fillStyle = SC.brand; ctx.beginPath(); ctx.arc(px(vals.length - 1), py(vals[vals.length - 1]), 11, 0, Math.PI * 2); ctx.fill();
  }
  sFooter(ctx);
}

// ---- Modal ----
const share = {kind: null, id: null, result: 'pct', blob: null};

async function renderShare(){
  await loadShareLogo();
  const canvas = document.getElementById('shareCanvas');
  canvas.width = SHARE_W; canvas.height = SHARE_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SHARE_W, SHARE_H);
  if(share.kind === 'trade'){
    const h = state.history.find(x=> x.id === share.id);
    if(!h) return closeShare();
    drawTradeCard(ctx, h, share);
  } else drawMonthCard(ctx, share.id, share);
  document.querySelectorAll('#shareResult button').forEach(b=> b.classList.toggle('active', b.dataset.v === share.result));
  // En la tarjeta del mes no hay opción R.
  document.querySelector('#shareResult button[data-v="r"]').style.display = share.kind === 'trade' ? '' : 'none';
  share.blob = await new Promise(res=> canvas.toBlob(res, 'image/png'));
}

function openShare(kind, id){
  Object.assign(share, {kind, id});
  if(kind === 'month' && share.result === 'r') share.result = 'pct';
  document.getElementById('shareTitle').textContent = kind === 'trade' ? t('Compartir trade') : t('Compartir mes');
  document.getElementById('shareMsg').textContent = '';
  document.getElementById('shareModal').style.display = 'flex';
  // Compartir con el menú del sistema solo si el navegador puede mandar archivos.
  const probe = new File([''], 'x.png', {type: 'image/png'});
  document.getElementById('shareNative').style.display = navigator.canShare && navigator.canShare({files: [probe]}) ? '' : 'none';
  renderShare();
}
function closeShare(){ document.getElementById('shareModal').style.display = 'none'; }

function shareFileName(){
  return share.kind === 'trade' ? `journal-trade-${dayKeyFromTs((state.history.find(x=> x.id === share.id) || {}).ts || Date.now())}.png` : `journal-${share.id}.png`;
}
document.getElementById('shareDownload').addEventListener('click', ()=>{
  if(!share.blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(share.blob);
  a.download = shareFileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
});
document.getElementById('shareNative').addEventListener('click', async ()=>{
  if(!share.blob) return;
  try{
    await navigator.share({files: [new File([share.blob], shareFileName(), {type: 'image/png'})], title: 'Journal Trading'});
  }catch(e){
    if(e.name !== 'AbortError') document.getElementById('shareMsg').textContent = t('No se pudo compartir. Descargá la imagen y subila a mano.');
  }
});
document.querySelectorAll('#shareResult button').forEach(b=> b.addEventListener('click', ()=>{ share.result = b.dataset.v; renderShare(); }));
document.querySelectorAll('[data-close-share]').forEach(b=> b.addEventListener('click', closeShare));
document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && document.getElementById('shareModal').style.display === 'flex') closeShare(); });
// Botones "Compartir" de otras pantallas (detalle del trade, cierre mensual).
document.addEventListener('click', e=>{
  const b = e.target.closest('[data-share-trade], [data-share-month]');
  if(!b) return;
  if(b.dataset.shareTrade) openShare('trade', b.dataset.shareTrade);
  else openShare('month', b.dataset.shareMonth);
});
