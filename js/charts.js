// Gráficos en SVG sin librerías. Se dibujan con el ancho real del contenedor
// y se vuelven a dibujar al cambiar el tamaño de la ventana o de pestaña.

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

  // series: [{values:[...], color, label, dashed, width}]
  // points: [{i, color, title}] marcadores sobre la primera serie.
  line(el, {series, points = [], height = 220, format = v=> v.toFixed(1) + '%'}){
    if(!el) return;
    const W = Math.max(260, Math.floor(el.clientWidth || 600));
    const H = height;
    const pad = {l: 46, r: 14, t: 14, b: 26};
    const n = Math.max(...series.map(s=> s.values.length));
    if(n < 2){
      el.innerHTML = '<div class="chart-empty">Registrá al menos un trade para ver tu curva.</div>';
      return;
    }
    const all = series.flatMap(s=> s.values).concat([0]);
    let min = Math.min(...all), max = Math.max(...all);
    if(max - min < 1){ max += 0.5; min -= 0.5; }
    const span = max - min;
    min -= span * 0.08; max += span * 0.08;
    const x = i=> pad.l + i * (W - pad.l - pad.r) / (n - 1);
    const y = v=> pad.t + (max - v) * (H - pad.t - pad.b) / (max - min);

    const ticks = this.niceTicks(min, max, 4);
    const grid = ticks.map(t=> `
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'ch-zero' : 'ch-grid'}"/>
      <text x="${pad.l - 8}" y="${y(t) + 4}" class="ch-label" text-anchor="end">${format(t)}</text>`).join('');

    const paths = series.map(s=>{
      const d = s.values.map((v, i)=> (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.25}" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="6 5"' : ''}/>`;
    }).join('');

    const base = series[0].values;
    const dots = points.map(p=> `<circle cx="${x(p.i)}" cy="${y(base[p.i])}" r="4" fill="${p.color}" stroke="var(--card)" stroke-width="1.5"><title>${p.title || ''}</title></circle>`).join('');

    // Zonas invisibles para ver el detalle de cada punto al pasar el mouse.
    const hits = base.map((v, i)=> i === 0 ? '' : `<rect x="${x(i) - (W / n) / 2}" y="${pad.t}" width="${W / n}" height="${H - pad.t - pad.b}" fill="transparent"><title>${(series[0].titles && series[0].titles[i]) || format(v)}</title></rect>`).join('');

    const xLabels = `
      <text x="${x(0)}" y="${H - 6}" class="ch-label" text-anchor="start">Inicio</text>
      <text x="${x(n - 1)}" y="${H - 6}" class="ch-label" text-anchor="end">Trade ${n - 1}</text>`;

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" class="chart-svg">${grid}${paths}${dots}${hits}${xLabels}</svg>`;
  },
};

let chartResizeTimer = null;
window.addEventListener('resize', ()=>{
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(()=> Charts.redrawAll(), 150);
});
window.addEventListener('tabshown', ()=> Charts.redrawAll());
