// Cálculos sobre el historial: curvas, agrupaciones y patrones automáticos.
// Usa `state` y los helpers de app.js (sessionOf, emotionById, errorById...).

const MIN_SAMPLE = 3;   // Trades mínimos en un grupo para sacar conclusiones.
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const WEEKDAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];

const Analytics = {
  // Trades del más viejo al más nuevo.
  chronological(list = state.history){
    return list.slice().sort((a, b)=> a.ts - b.ts);
  },

  pct(h){
    return (h.resultPct === null || h.resultPct === undefined) ? 0 : h.resultPct;
  },

  // Curva real y curva "solo trades con el plan seguido", trade por trade.
  equityCurves(list = state.history){
    const trades = this.chronological(list);
    let real = 0, plan = 0;
    const realPts = [0], planPts = [0];
    trades.forEach(h=>{
      real += this.pct(h);
      if(h.followedPlan) plan += this.pct(h);
      realPts.push(real);
      planPts.push(plan);
    });
    return {trades, real: realPts, plan: planPts};
  },

  // Agrupa y resume: cantidad, promedio, % plan seguido y win rate.
  group(list, keyFn){
    const groups = {};
    list.forEach(h=>{
      const keys = [].concat(keyFn(h)).filter(k=> k !== null && k !== undefined && k !== '');
      keys.forEach(k=>{
        if(!groups[k]) groups[k] = [];
        groups[k].push(h);
      });
    });
    return Object.entries(groups).map(([key, items])=> this.summary(items, key));
  },

  summary(items, key){
    const n = items.length;
    const sum = items.reduce((a, h)=> a + this.pct(h), 0);
    // El promedio solo cuenta los trades que tienen el % de resultado cargado.
    const withPct = items.filter(h=> h.resultPct !== null && h.resultPct !== undefined).length;
    const wins = items.filter(h=> h.result === 'win').length;
    const followed = items.filter(h=> h.followedPlan).length;
    return {key, n, sum, avg: withPct ? sum / withPct : 0, winRate: n ? wins / n * 100 : 0, planPct: n ? followed / n * 100 : 0};
  },

  weekdayOf(ts){
    return (new Date(ts).getDay() + 6) % 7; // lunes = 0
  },

  hourOf(ts){
    return new Date(ts).getHours();
  },

  // Matriz día de la semana x hora de entrada.
  heatmap(list = state.history){
    const cells = {};
    list.forEach(h=>{
      const d = this.weekdayOf(h.ts), hr = this.hourOf(h.ts);
      const k = d + '-' + hr;
      if(!cells[k]) cells[k] = {n: 0, broken: 0, sum: 0};
      cells[k].n++;
      if(!h.followedPlan) cells[k].broken++;
      cells[k].sum += this.pct(h);
    });
    return {cells};
  },

  // Lunes (00:00) de la semana de ts, como clave AAAA-MM-DD.
  weekStart(ts){
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - this.weekdayOf(d.getTime()));
    return d;
  },

  weekKey(ts){
    const d = this.weekStart(ts);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  tradesOfWeek(key){
    return state.history.filter(h=> this.weekKey(h.ts) === key);
  },

  // Patrones automáticos. Cada uno: {tone: 'good'|'bad'|'info', icon, text, weight}.
  insights(list = state.history){
    const out = [];
    const trades = this.chronological(list);
    if(trades.length < MIN_SAMPLE) return out;
    const fmt = v=> (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    const pctTxt = v=> Math.round(v) + '%';

    // 1. Plan después de una pérdida.
    const afterLoss = [], afterOther = [];
    for(let i = 1; i < trades.length; i++){
      (this.pct(trades[i-1]) < 0 || trades[i-1].result === 'loss' ? afterLoss : afterOther).push(trades[i]);
    }
    if(afterLoss.length >= MIN_SAMPLE && afterOther.length >= MIN_SAMPLE){
      const a = 100 - this.summary(afterLoss).planPct, b = 100 - this.summary(afterOther).planPct;
      if(a - b >= 15) out.push({tone: 'bad', icon: 'alert-triangle', weight: 90 + (a - b) / 10,
        text: `Después de una pérdida rompés el plan el <b>${pctTxt(a)}</b> de las veces (contra ${pctTxt(b)} el resto). Ojo con la revancha.`});
      else if(b - a >= 15) out.push({tone: 'good', icon: 'shield-check', weight: 50,
        text: `Después de una pérdida mantenés la cabeza fría: rompés el plan solo el ${pctTxt(a)} de las veces.`});
    }

    // 2. Plan seguido vs. roto.
    const followed = trades.filter(h=> h.followedPlan), broken = trades.filter(h=> !h.followedPlan);
    if(followed.length >= MIN_SAMPLE && broken.length >= MIN_SAMPLE){
      const f = this.summary(followed), b = this.summary(broken);
      if(f.avg > b.avg) out.push({id: 'plan_vs_broken', tone: 'info', icon: 'chart-column', weight: 70,
        text: `Cuando seguís tu plan promediás <b>${fmt(f.avg)}</b> por trade; cuando lo rompés, <b>${fmt(b.avg)}</b>.`});
      if(b.sum < 0) out.push({id: 'broken_cost', tone: 'bad', icon: 'trending-down', weight: 85,
        text: `Romper el plan ya te costó <b>${fmt(b.sum)}</b> en total (${b.n} trades).`});
    }

    // 3. Emociones: la peor y la mejor.
    const emo = this.group(trades, h=> h.emotion).filter(g=> g.n >= MIN_SAMPLE);
    if(emo.length >= 2){
      emo.sort((x, y)=> x.avg - y.avg);
      const worst = emo[0], best = emo[emo.length - 1];
      const w = emotionById(worst.key), bE = emotionById(best.key);
      if(worst.avg < 0) out.push({tone: 'bad', icon: 'frown', weight: 80,
        text: `Tus trades con <b>${emotionWord(w)}</b> promedian <b>${fmt(worst.avg)}</b> (${worst.n} trades).`});
      if(best.avg > 0 && best.key !== worst.key) out.push({tone: 'good', icon: 'smile', weight: 60,
        text: `Operando <b>${emotionWord(bE)}</b> promediás <b>${fmt(best.avg)}</b> por trade.`});
    } else if(emo.length === 1 && emo[0].avg < 0){
      const e = emotionById(emo[0].key);
      out.push({tone: 'bad', icon: 'frown', weight: 70, text: `Tus trades con <b>${emotionWord(e)}</b> promedian <b>${fmt(emo[0].avg)}</b>.`});
    }

    // 4. Error más frecuente.
    const errs = this.group(trades, h=> h.errors || []).sort((x, y)=> y.n - x.n);
    if(errs.length && errs[0].n >= 2){
      const e = errorById(errs[0].key);
      if(e) out.push({tone: 'bad', icon: 'repeat', weight: 75 + errs[0].n,
        text: `Tu error más repetido es <b>"${e.label}"</b>: ${errs[0].n} veces, con un resultado promedio de <b>${fmt(errs[0].avg)}</b>.`});
    }

    // 5. Mejor sesión y mejor horario.
    const sessions = this.group(trades, h=> sessionOf(h.ts)).filter(g=> g.n >= MIN_SAMPLE).sort((x, y)=> y.avg - x.avg);
    if(sessions.length >= 2 && sessions[0].avg > 0) out.push({tone: 'good', icon: 'clock', weight: 55,
      text: `Tu mejor sesión es <b>${sessions[0].key}</b>: promediás ${fmt(sessions[0].avg)} por trade.`});
    const hours = this.group(trades, h=> this.hourOf(h.ts)).filter(g=> g.n >= MIN_SAMPLE).sort((x, y)=> y.avg - x.avg);
    if(hours.length >= 2 && hours[0].avg > 0){
      const hr = Number(hours[0].key);
      out.push({tone: 'good', icon: 'clock', weight: 58, text: `Tu mejor horario es de <b>${hr}:00 a ${(hr + 1) % 24}:00</b> (${fmt(hours[0].avg)} por trade).`});
    }
    if(hours.length >= 2){
      // El horario donde menos respetás el plan (no el de peor resultado).
      const worstH = hours.slice().sort((x, y)=> x.planPct - y.planPct)[0];
      if(worstH.planPct < 60) out.push({tone: 'bad', icon: 'moon', weight: 65,
        text: `Entre las ${worstH.key}:00 y las ${(Number(worstH.key) + 1) % 24}:00 seguís tu plan solo el ${pctTxt(worstH.planPct)} de las veces.`});
    }

    // 6. Día de la semana.
    const days = this.group(trades, h=> this.weekdayOf(h.ts)).filter(g=> g.n >= MIN_SAMPLE).sort((x, y)=> x.planPct - y.planPct);
    if(days.length >= 2 && days[days.length - 1].planPct - days[0].planPct >= 20) out.push({tone: 'bad', icon: 'calendar', weight: 60,
      text: `Los <b>${WEEKDAYS_LONG[days[0].key]}</b> es cuando más rompés el plan (lo seguís el ${pctTxt(days[0].planPct)} de las veces).`});

    // 7. Confianza alta vs. baja.
    const hi = trades.filter(h=> h.confidence >= 4), lo = trades.filter(h=> h.confidence && h.confidence <= 2);
    if(hi.length >= MIN_SAMPLE && lo.length >= MIN_SAMPLE){
      const H = this.summary(hi), L = this.summary(lo);
      out.push({tone: H.avg >= L.avg ? 'good' : 'bad', icon: 'target', weight: 52,
        text: H.avg >= L.avg
          ? `Tu intuición funciona: con confianza alta promediás ${fmt(H.avg)}, con confianza baja ${fmt(L.avg)}.`
          : `Cuidado con el exceso de confianza: con confianza alta promediás ${fmt(H.avg)}, menos que con confianza baja (${fmt(L.avg)}).`});
    }

    // 8. Long vs. short.
    const longs = trades.filter(h=> h.direction === 'long'), shorts = trades.filter(h=> h.direction === 'short');
    if(longs.length >= MIN_SAMPLE && shorts.length >= MIN_SAMPLE){
      const Lg = this.summary(longs), Sh = this.summary(shorts);
      if(Math.abs(Lg.avg - Sh.avg) >= 0.3){
        const better = Lg.avg > Sh.avg ? ['longs', Lg, 'shorts', Sh] : ['shorts', Sh, 'longs', Lg];
        out.push({tone: 'info', icon: 'arrow-up-down', weight: 45, text: `Te va mejor en <b>${better[0]}</b> (${fmt(better[1].avg)} por trade) que en ${better[2]} (${fmt(better[3].avg)}).`});
      }
    }

    // 9. R:R planeado vs. real.
    const withR = trades.filter(h=> h.rrPlanned && h.result === 'win' && realR(h) !== null);
    if(withR.length >= MIN_SAMPLE){
      const planned = withR.reduce((a, h)=> a + h.rrPlanned, 0) / withR.length;
      const real = withR.reduce((a, h)=> a + realR(h), 0) / withR.length;
      if(real < planned * 0.8) out.push({tone: 'bad', icon: 'scissors', weight: 68,
        text: `En tus ganadores planeás 1:${planned.toFixed(1)} pero cobrás ${real.toFixed(1)}R en promedio: estás cerrando antes de tiempo.`});
    }

    return out.sort((a, b)=> b.weight - a.weight);
  },
};
