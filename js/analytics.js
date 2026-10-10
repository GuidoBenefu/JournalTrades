// Cálculos sobre el historial: curvas, agrupaciones y patrones automáticos.
// Usa `state` y los helpers de app.js (sessionOf, emotionById, errorById...).

const MIN_SAMPLE = 3;   // Trades mínimos en un grupo para sacar conclusiones.
const WEEKDAYS = [t('Lun'), t('Mar'), t('Mié'), t('Jue'), t('Vie'), t('Sáb'), t('Dom')];
const WEEKDAYS_LONG = [t('lunes'), t('martes'), t('miércoles'), t('jueves'), t('viernes'), t('sábados'), t('domingos')];

const Analytics = {
  // Trades del más viejo al más nuevo.
  chronological(list = viewTrades()){
    return list.slice().sort((a, b)=> a.ts - b.ts);
  },

  pct(h){
    return (h.resultPct === null || h.resultPct === undefined) ? 0 : h.resultPct;
  },

  // Curva real y curva "solo trades con el plan seguido", trade por trade.
  equityCurves(list = viewTrades()){
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

  // Día de la semana (lunes = 0) y hora de entrada, en hora de Nueva York.
  weekdayOf(ts){
    return weekdayOf(ts);
  },

  hourOf(ts){
    return nyHourOf(ts);
  },

  // Matriz día de la semana x hora de entrada.
  heatmap(list = viewTrades()){
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

  // Lunes de la semana de trading de ts, como clave AAAA-MM-DD.
  weekKey(ts){
    const k = dayKeyFromTs(ts);
    return addDaysKey(k, -weekdayOfKey(k));
  },

  // Instante en que empieza esa semana (según el cierre del día elegido).
  weekStart(ts){
    return new Date(dayStartTs(this.weekKey(ts)));
  },

  tradesOfWeek(key){
    return viewTrades().filter(h=> this.weekKey(h.ts) === key);
  },

  // Patrones automáticos. Cada uno: {tone: 'good'|'bad'|'info', icon, text, weight}.
  insights(list = viewTrades()){
    const out = [];
    const trades = this.chronological(list);
    if(trades.length < MIN_SAMPLE) return out;
    const fmt = fmtSignedPct;
    const pctTxt = v=> Math.round(v) + '%';

    // 1. Plan después de una pérdida.
    const afterLoss = [], afterOther = [];
    for(let i = 1; i < trades.length; i++){
      (this.pct(trades[i-1]) < 0 || trades[i-1].result === 'loss' ? afterLoss : afterOther).push(trades[i]);
    }
    if(afterLoss.length >= MIN_SAMPLE && afterOther.length >= MIN_SAMPLE){
      const a = 100 - this.summary(afterLoss).planPct, b = 100 - this.summary(afterOther).planPct;
      if(a - b >= 15) out.push({tone: 'bad', icon: 'alert-triangle', weight: 90 + (a - b) / 10,
        text: t('Después de una pérdida rompés el plan el <b>{a}</b> de las veces (contra {b} el resto). Ojo con la revancha.', {a: pctTxt(a), b: pctTxt(b)})});
      else if(b - a >= 15) out.push({tone: 'good', icon: 'shield-check', weight: 50,
        text: t('Después de una pérdida mantenés la cabeza fría: rompés el plan solo el {a} de las veces.', {a: pctTxt(a)})});
    }

    // 2. Plan seguido vs. roto.
    const followed = trades.filter(h=> h.followedPlan), broken = trades.filter(h=> !h.followedPlan);
    if(followed.length >= MIN_SAMPLE && broken.length >= MIN_SAMPLE){
      const f = this.summary(followed), b = this.summary(broken);
      if(f.avg > b.avg) out.push({id: 'plan_vs_broken', tone: 'info', icon: 'chart-column', weight: 70,
        text: t('Cuando seguís tu plan promediás <b>{f}</b> por trade; cuando lo rompés, <b>{b}</b>.', {f: fmt(f.avg), b: fmt(b.avg)})});
      if(b.sum < 0) out.push({id: 'broken_cost', tone: 'bad', icon: 'trending-down', weight: 85,
        text: t('Romper el plan ya te costó <b>{sum}</b> en total ({n} trades).', {sum: fmt(b.sum), n: b.n})});
    }

    // 3. Emociones: la peor y la mejor.
    const emo = this.group(trades, h=> h.emotion).filter(g=> g.n >= MIN_SAMPLE);
    if(emo.length >= 2){
      emo.sort((x, y)=> x.avg - y.avg);
      const worst = emo[0], best = emo[emo.length - 1];
      const w = emotionById(worst.key), bE = emotionById(best.key);
      if(worst.avg < 0) out.push({tone: 'bad', icon: 'frown', weight: 80,
        text: t('Tus trades con <b>{emo}</b> promedian <b>{avg}</b> ({n} trades).', {emo: emotionWord(w), avg: fmt(worst.avg), n: worst.n})});
      if(best.avg > 0 && best.key !== worst.key) out.push({tone: 'good', icon: 'smile', weight: 60,
        text: t('Operando <b>{emo}</b> promediás <b>{avg}</b> por trade.', {emo: emotionWord(bE), avg: fmt(best.avg)})});
    } else if(emo.length === 1 && emo[0].avg < 0){
      const e = emotionById(emo[0].key);
      out.push({tone: 'bad', icon: 'frown', weight: 70, text: t('Tus trades con <b>{emo}</b> promedian <b>{avg}</b>.', {emo: emotionWord(e), avg: fmt(emo[0].avg)})});
    }

    // 4. Error más frecuente.
    const errs = this.group(trades, h=> h.errors || []).sort((x, y)=> y.n - x.n);
    if(errs.length && errs[0].n >= 2){
      const e = errorById(errs[0].key);
      if(e) out.push({tone: 'bad', icon: 'repeat', weight: 75 + errs[0].n,
        text: t('Tu error más repetido es <b>"{err}"</b>: {n} veces, con un resultado promedio de <b>{avg}</b>.', {err: e.label, n: errs[0].n, avg: fmt(errs[0].avg)})});
    }

    // 5. Mejor sesión y mejor horario.
    const sessions = this.group(trades, h=> sessionOf(h.ts)).filter(g=> g.n >= MIN_SAMPLE).sort((x, y)=> y.avg - x.avg);
    if(sessions.length >= 2 && sessions[0].avg > 0) out.push({tone: 'good', icon: 'clock', weight: 55,
      text: t('Tu mejor sesión es <b>{s}</b>: promediás {avg} por trade.', {s: sessions[0].key, avg: fmt(sessions[0].avg)})});
    const hours = this.group(trades, h=> this.hourOf(h.ts)).filter(g=> g.n >= MIN_SAMPLE).sort((x, y)=> y.avg - x.avg);
    if(hours.length >= 2 && hours[0].avg > 0){
      const hr = Number(hours[0].key);
      out.push({tone: 'good', icon: 'clock', weight: 58, text: t('Tu mejor horario es de <b>{from}:00 a {to}:00</b> hora NY ({avg} por trade).', {from: hr, to: (hr + 1) % 24, avg: fmt(hours[0].avg)})});
    }
    if(hours.length >= 2){
      // El horario donde menos respetás el plan (no el de peor resultado).
      const worstH = hours.slice().sort((x, y)=> x.planPct - y.planPct)[0];
      if(worstH.planPct < 60) out.push({tone: 'bad', icon: 'moon', weight: 65,
        text: t('Entre las {from}:00 y las {to}:00 (hora NY) seguís tu plan solo el {pct} de las veces.', {from: worstH.key, to: (Number(worstH.key) + 1) % 24, pct: pctTxt(worstH.planPct)})});
    }

    // 6. Día de la semana.
    const days = this.group(trades, h=> this.weekdayOf(h.ts)).filter(g=> g.n >= MIN_SAMPLE).sort((x, y)=> x.planPct - y.planPct);
    if(days.length >= 2 && days[days.length - 1].planPct - days[0].planPct >= 20) out.push({tone: 'bad', icon: 'calendar', weight: 60,
      text: t('Los <b>{day}</b> es cuando más rompés el plan (lo seguís el {pct} de las veces).', {day: WEEKDAYS_LONG[days[0].key], pct: pctTxt(days[0].planPct)})});

    // 7. Confianza alta vs. baja.
    const hi = trades.filter(h=> h.confidence >= 4), lo = trades.filter(h=> h.confidence && h.confidence <= 2);
    if(hi.length >= MIN_SAMPLE && lo.length >= MIN_SAMPLE){
      const H = this.summary(hi), L = this.summary(lo);
      out.push({tone: H.avg >= L.avg ? 'good' : 'bad', icon: 'target', weight: 52,
        text: H.avg >= L.avg
          ? t('Tu intuición funciona: con confianza alta promediás {hi}, con confianza baja {lo}.', {hi: fmt(H.avg), lo: fmt(L.avg)})
          : t('Cuidado con el exceso de confianza: con confianza alta promediás {hi}, menos que con confianza baja ({lo}).', {hi: fmt(H.avg), lo: fmt(L.avg)})});
    }

    // 8. Long vs. short.
    const longs = trades.filter(h=> h.direction === 'long'), shorts = trades.filter(h=> h.direction === 'short');
    if(longs.length >= MIN_SAMPLE && shorts.length >= MIN_SAMPLE){
      const Lg = this.summary(longs), Sh = this.summary(shorts);
      if(Math.abs(Lg.avg - Sh.avg) >= 0.3){
        const better = Lg.avg > Sh.avg ? ['longs', Lg, 'shorts', Sh] : ['shorts', Sh, 'longs', Lg];
        out.push({tone: 'info', icon: 'arrow-up-down', weight: 45, text: t('Te va mejor en <b>{a}</b> ({avgA} por trade) que en {b} ({avgB}).', {a: better[0], avgA: fmt(better[1].avg), b: better[2], avgB: fmt(better[3].avg)})});
      }
    }

    // 9. R:R planeado vs. real.
    const withR = trades.filter(h=> h.rrPlanned && h.result === 'win' && realR(h) !== null);
    if(withR.length >= MIN_SAMPLE){
      const planned = withR.reduce((a, h)=> a + h.rrPlanned, 0) / withR.length;
      const real = withR.reduce((a, h)=> a + realR(h), 0) / withR.length;
      if(real < planned * 0.8) out.push({tone: 'bad', icon: 'scissors', weight: 68,
        text: t('En tus ganadores planeás 1:{planned} pero cobrás {real}R en promedio: estás cerrando antes de tiempo.', {planned: planned.toFixed(1), real: real.toFixed(1)})});
    }

    return out.sort((a, b)=> b.weight - a.weight);
  },
};
