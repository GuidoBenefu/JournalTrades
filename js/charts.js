// Gráficos en SVG sin librerías. Se dibujan con el ancho real del contenedor
// y se vuelven a dibujar al cambiar el tamaño de la ventana o de pestaña.

// Cartel flotante compartido por los gráficos y el mapa de calor.
const ChartTip = {
  el: null,
  show(html, clientX, clientY){
    if(!this.el) this.el = document.getElementById('chartTip');
    if(!this.el) return;
    this.el.innerHTML = html;
    this.el.classList.add('show');
    const r = this.el.getBoundingClientRect();
    let x = clientX + 14, y = clientY - r.height - 12;
    if(x + r.width > window.innerWidth - 8) x = clientX - r.width - 14;
    if(y < 8) y = clientY + 16;
    this.el.style.left = Math.max(8, x) + 'px';
    this.el.style.top = y + 'px';
  },
  hide(){
    if(this.el) this.el.classList.remove('show');
  },
};

const Charts = {
  _redraws: [],

  // Registra una función de dibujo para repetirla al redimensionar.
  register(fn){
    this._redraws.push(fn);
  },

  redrawAll(){
    this._redraws.forEach(fn=> fn());
  },

  niceTicks(min, max, count){
    const span = max - min || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m=> m * mag).find(s=> s >= raw) || raw;
    const ticks = [];
    for(let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  },

  // series: [{values:[...], color, label, dashed, width, titles}]
  // points: [{i, color}] marcadores sobre la primera serie.
  // area: sombrea debajo de la primera serie. band: pinta lo que la segunda
  // serie queda por encima de la primera (lo que costó romper el plan).
  line(el, {series, points = [], height = 220, format = v=> v.toFixed(1) + '%', area = false, band = false}){
    // Un gráfico en una pestaña oculta se dibuja recién cuando se muestra.
    if(!el || !el.offsetParent) return;
    const W = Math.max(260, Math.floor(el.clientWidth || 600));
    // Al mostrar una pestaña solo se redibuja si cambió el ancho (los datos ya están al día).
    if(Charts._onlyIfResized && el.dataset.w === String(W)) return;
    el.dataset.w = W;
    const H = height;
    const pad = {l: 46, r: 14, t: 14, b: 26};
    const n = Math.max(...series.map(s=> s.values.length));
    if(n < 2){
      el.innerHTML = `<div class="chart-empty">${t('Registrá al menos un trade para ver tu curva.')}</div>`;
      return;
    }
    const all = series.flatMap(s=> s.values).concat([0]);
    let min = Math.min(...all), max = Math.max(...all);
    if(max - min < 1){ max += 0.5; min -= 0.5; }
    const span = max - min;
    min -= span * 0.08; max += span * 0.08;
    const x = i=> pad.l + i * (W - pad.l - pad.r) / (n - 1);
    const y = v=> pad.t + (max - v) * (H - pad.t - pad.b) / (max - min);
    const id = (el.id || 'ch') + '-g';

    const ticks = this.niceTicks(min, max, 4);
    const grid = ticks.map(t=> `
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'ch-zero' : 'ch-grid'}"/>
      <text x="${pad.l - 8}" y="${y(t) + 4}" class="ch-label" text-anchor="end">${format(t)}</text>`).join('');

    const base = series[0].values;
    const pts = vals=> vals.map((v, i)=> x(i).toFixed(1) + ' ' + y(v).toFixed(1));
    let fills = '';
    if(area){
      fills += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${series[0].color}" stop-opacity=".28"/><stop offset="1" stop-color="${series[0].color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="M${pts(base).join(' L')} L${x(n - 1)} ${H - pad.b} L${x(0)} ${H - pad.b} Z" fill="url(#${id})"/>`;
    }
    if(band && series[1]){
      const upper = series[1].values.map((v, i)=> Math.max(v, base[i]));
      fills += `<path d="M${pts(upper).join(' L')} L${pts(base).reverse().join(' L')} Z" class="ch-band"/>`;
    }

    const paths = series.map(s=>{
      const d = s.values.map((v, i)=> (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.25}" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="6 5"' : ''}/>`;
    }).join('');

    const dots = points.map(p=> `<circle cx="${x(p.i)}" cy="${y(base[p.i])}" r="4" fill="${p.color}" stroke="var(--card)" stroke-width="1.5"/>`).join('');

    const xLabels = `
      <text x="${x(0)}" y="${H - 6}" class="ch-label" text-anchor="start">${tc('curva', 'Inicio')}</text>
      <text x="${x(n - 1)}" y="${H - 6}" class="ch-label" text-anchor="end">${t('Trade {n}', {n: n - 1})}</text>`;

    const hover = `<line class="ch-guide" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" style="display:none"/>
      <circle class="ch-hover" r="5" fill="${series[0].color}" stroke="var(--card)" stroke-width="2" style="display:none"/>`;

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" class="chart-svg">${grid}${fills}${paths}${dots}${xLabels}${hover}</svg>`;

    // Detalle al pasar el mouse o tocar: el punto más cercano de la curva.
    const svg = el.querySelector('svg');
    const guide = svg.querySelector('.ch-guide'), dot = svg.querySelector('.ch-hover');
    const titles = series[0].titles;
    const move = e=>{
      const pt = e.touches ? e.touches[0] : e;
      const rect = svg.getBoundingClientRect();
      const sx = (pt.clientX - rect.left) * (W / rect.width);
      const i = Math.max(0, Math.min(n - 1, Math.round((sx - pad.l) / ((W - pad.l - pad.r) / (n - 1)))));
      guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.style.display = '';
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(base[i])); dot.style.display = '';
      const tip = typeof titles === 'function' ? titles(i) : titles && titles[i];
      ChartTip.show(tip || format(base[i]), pt.clientX, pt.clientY);
    };
    const leave = ()=>{ guide.style.display = 'none'; dot.style.display = 'none'; ChartTip.hide(); };
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', leave);
    svg.addEventListener('touchstart', move, {passive: true});
    svg.addEventListener('touchmove', move, {passive: true});
    svg.addEventListener('touchend', ()=> setTimeout(leave, 1500));
  },

  // Línea mínima para las tarjetas de números.
  spark(values, cls = ''){
    if(!values || values.length < 2) return '';
    const W = 100, H = 28;
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min;
    // Si todos los valores son iguales, la línea va por el medio (no pegada abajo).
    const y = v=> span ? H - 2 - (v - min) / span * (H - 4) : H / 2;
    const p = values.map((v, i)=> (i * W / (values.length - 1)).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    return `<svg class="spark ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${p}"/></svg>`;
  },
};

let chartResizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(()=> Charts.redrawAll(), 150);
});
window.addEventListener('tabshown', ()=>{
  ChartTip.hide();
  Charts._onlyIfResized = true;
  try{ Charts.redrawAll(); } finally { Charts._onlyIfResized = false; }
});
