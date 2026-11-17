// Car analysis: turns the timings in the platform's Heats file into numbers, on-screen graphics and a commentary script.
//   SRIAnalysis.build(event)  ->  {metric, teams: {id: stats}, ranked, stories: [{id, title, scene, script}], script}
// A "scene" is what the big screen draws (see analysis/output.html). Nothing here touches the page.
(function (root) {
  const TRACK = 20;                                     // metres of track
  const sec = ms => (ms / 1000).toFixed(3), thou = ms => Math.round(ms) + " thousandth" + (Math.round(ms) === 1 ? "" : "s");
  const cm = n => n + " centimetre" + (n === 1 ? "" : "s");
  const kmh = ms => (TRACK / (ms / 1000) * 3.6);
  // how far apart two cars are at the line, taking the slower car's average speed
  const gapCm = (fast, slow) => Math.round((slow - fast) / 1000 * (TRACK / (slow / 1000)) * 100);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) * (x - m)))); };
  // 0-100: where a value sits in the field (100 = best)
  const pct = (all, v, lowBest) => { if (v == null || all.length < 2) return null; const worse = all.filter(x => lowBest ? x > v : x < v).length, same = all.filter(x => x === v).length;
    return Math.round((worse + (same - 1) / 2) / (all.length - 1) * 100); };

  // least-squares line through points, and how strongly they follow it (r)
  function fitLine(ps) { const n = ps.length, mx = mean(ps.map(p => p.x)), my = mean(ps.map(p => p.y)); let sxy = 0, sxx = 0, syy = 0;
    ps.forEach(p => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); syy += (p.y - my) * (p.y - my); });
    const m = sxx ? sxy / sxx : 0; return {m, c: my - m * mx, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0, n}; }
  function build(ev, cars) {
    const done = (ev.runs || []).filter(r => r.status === "finished" && typeof r.total === "number");
    // with a reaction time on every run the car's own time down the track can be separated out; otherwise totals are used
    const split = done.length > 0 && done.every(r => typeof r.reaction === "number" && r.reaction < r.total);
    const metric = split ? "track" : "total", label = split ? "track time" : "time";
    const T = {}, name = id => (T[id] || {name: "Team " + id}).name;
    ev.teams.forEach(t => { T[t.id] = {id: t.id, name: t.name, runs: []}; });
    done.forEach(r => { if (T[r.team]) T[r.team].runs.push({n: r.n, code: r.code, car: r.car, phase: r.phase, opp: r.opp, total: r.total, reaction: split ? r.reaction : null, t: split ? r.total - r.reaction : r.total}); });
    const byHeat = {}; done.forEach(r => (byHeat[r.n] = byHeat[r.n] || []).push(r));
    const list = Object.values(T).filter(t => t.runs.length);
    list.forEach(t => { t.runs.sort((a, b) => a.n - b.n); const ts = t.runs.map(r => r.t), sorted = ts.slice().sort((a, b) => a - b);
      t.count = ts.length; t.best = sorted[0]; t.bestRun = t.runs.find(r => r.t === t.best); t.mean = mean(ts); t.spread = sorted[sorted.length - 1] - sorted[0]; t.sd = sd(ts);
      t.first = ts[0]; t.gain = t.first - t.best; t.speed = kmh(t.best);
      // the Fastest Car measure used at the World Finals: second to fifth best times, averaged
      t.avg25 = sorted.length >= 5 ? mean(sorted.slice(1, 5)) : null;
      const rs = t.runs.map(r => r.reaction).filter(x => x != null); t.react = rs.length ? Math.min(...rs) : null; t.reactMean = rs.length ? mean(rs) : null;
      let races = 0, wins = 0; t.runs.forEach(r => { const pair = byHeat[r.n] || []; if (pair.length === 2 && pair[0].team !== pair[1].team && pair[0].total !== pair[1].total) { races++; if (Math.min(pair[0].total, pair[1].total) === r.total) wins++; } });
      t.races = races; t.wins = wins; t.winRate = races ? wins / races : null; });
    // the size of the car that set the team's best time (or its other car, if that one was not measured)
    const sized = cars && cars.teams || {};
    list.forEach(t => { const c = sized[t.id] || {}, d = [c[t.bestRun.car], c.A, c.B].find(x => x && x.w != null) || [c[t.bestRun.car], c.A, c.B].find(Boolean) || {};
      t.width = d.w != null ? d.w : null; t.height = d.h != null ? d.h : null; t.weight = d.g != null ? d.g : null; t.env = t.width != null && t.height != null ? t.width * t.height / 100 : null; });
    const ranked = list.slice().sort((a, b) => a.best - b.best || a.id.localeCompare(b.id));
    ranked.forEach((t, k) => { t.rank = k + 1; });
    const col = (f, ok) => list.filter(t => !ok || ok(t)).map(f).filter(x => x != null);
    const multi = t => t.count >= 2;
    list.forEach(t => { t.radar = [
      ["Pace", pct(col(x => x.best), t.best, true)], ["Launch", pct(col(x => x.react), t.react, true)],
      ["Consistency", multi(t) ? pct(col(x => x.spread, multi), t.spread, true) : null], ["Average", pct(col(x => x.mean), t.mean, true)],
      ["Progress", multi(t) ? pct(col(x => x.gain, multi), t.gain, false) : null], ["Head to head", pct(col(x => x.winRate), t.winRate, false)]]; });

    const stories = [], add = (id, title, scene, script) => stories.push({id, title, scene: Object.assign({title}, scene), script});
    const out = {metric, label, split, teams: T, ranked, stories, script: "", runs: done.length, track: TRACK};
    if (!ranked.length) return out;
    const lead = ranked[0], second = ranked[1], third = ranked[2];
    const duelOf = (a, b, ra, rb, note) => ({kind: "duel", eyebrow: note, a: {id: a.id, total: ra.total, reaction: ra.reaction, t: ra.t}, b: {id: b.id, total: rb.total, reaction: rb.reaction, t: rb.t},
      gapMs: Math.abs(ra.total - rb.total), gapCm: gapCm(Math.min(ra.total, rb.total), Math.max(ra.total, rb.total))});
    // 1. leaderboard
    add("board", "Fastest cars so far", {kind: "board", eyebrow: "Best " + label + " down the " + TRACK + " metre track", rows: ranked.slice(0, 8).map(t => ({id: t.id, ms: t.best, kmh: t.speed}))},
      "Let's start with the leaderboard. " + lead.name + " hold the fastest " + label + " of the event so far, " + sec(lead.best) + " seconds down the " + TRACK + " metre track. That is an average of " + lead.speed.toFixed(1) + " kilometres an hour from a standing start."
      + (second ? " " + second.name + " are " + thou(second.best - lead.best) + " back" + (third ? ", with " + third.name + " third on " + sec(third.best) : "") + "." : ""));
    // 2. closest finish
    let close = null; Object.values(byHeat).forEach(p => { if (p.length !== 2 || p[0].team === p[1].team) return; const d = Math.abs(p[0].total - p[1].total); if (!close || d < close.d) close = {d, p}; });
    if (close) { const [x, y] = close.p[0].total <= close.p[1].total ? close.p : [close.p[1], close.p[0]], rx = T[x.team].runs.find(r => r.n === x.n), ry = T[y.team].runs.find(r => r.n === y.n);
      const sc = duelOf(T[x.team], T[y.team], rx, ry, "Closest finish · " + x.code);
      const launch = split ? (rx.reaction === ry.reaction ? " Both cars left the line together." : " Off the line the faster reaction was " + name(rx.reaction < ry.reaction ? x.team : y.team) + ", " + sec(Math.min(rx.reaction, ry.reaction)) + " against " + sec(Math.max(rx.reaction, ry.reaction)) + ".") : "";
      add("closest", "Closest finish", sc, "The closest finish so far came in " + x.code + ", " + name(x.team) + " against " + name(y.team) + "." + launch
        + (close.d === 0 ? " At the line it was a dead heat, to the thousandth of a second." : " At the line " + name(x.team) + " took it by " + thou(close.d) + " of a second. On the track that is about " + cm(sc.gapCm) + "" + (split && (rx.reaction < ry.reaction) !== (rx.t < ry.t) ? ", and it was " + (rx.t < ry.t ? "won on the track, not at the start" : "won at the start, not on the track") : "") + ".")); }
    // 3. fastest reaction
    const reactors = list.filter(t => t.react != null).sort((a, b) => a.react - b.react);
    if (reactors.length) { const r = reactors[0];
      add("reaction", "Fastest reaction", {kind: "stat", eyebrow: "Fastest reaction", team: r.id, value: sec(r.react), unit: "seconds", sub: reactors[1] ? "Next best: " + reactors[1].name + ", " + sec(reactors[1].react) : ""},
        "The race starts with the driver. The fastest reaction of the event belongs to " + r.name + ", " + sec(r.react) + " seconds from the lights to the trigger." + (reactors[1] ? " " + reactors[1].name + " are next on " + sec(reactors[1].react) + "." : "")
        + " Reaction time counts in every race, so a tenth gained here is a tenth the car does not have to find."); }
    // 4. most consistent
    const steady = list.filter(t => t.count >= 3).sort((a, b) => a.spread - b.spread)[0];
    const runsOf = (t, note) => ({kind: "runs", eyebrow: note, team: t.id, runs: t.runs.map(r => ({code: r.code, ms: r.t})), best: t.best, spread: t.spread, gain: t.gain, mean: t.mean, fieldBest: lead.best});
    if (steady) add("steady", "Most consistent car", runsOf(steady, "Most consistent car"),
      steady.name + " are relentlessly consistent. Across " + steady.count + " runs, their slowest and fastest are separated by just " + thou(steady.spread) + " of a second. A car that repeats its time is a car you can trust in a knockout, where there is no second chance.");
    // 5. biggest improver
    const climber = list.filter(t => t.count >= 2 && t.gain > 0).sort((a, b) => b.gain - a.gain)[0];
    if (climber && (!steady || climber.id !== steady.id)) add("climber", "Biggest improvement", runsOf(climber, "Biggest improvement since the first run"),
      "The car that has found the most time is " + climber.name + ". Their first run was " + sec(climber.first) + ", their best is now " + sec(climber.best) + ", a gain of " + thou(climber.gain) + ". That is a car warming up to the occasion.");
    // 6. one fast run against consistency, side by side
    const rival = steady && steady.id !== lead.id ? steady : second;
    if (rival) { const fast = lead.best <= rival.best ? lead : rival, slow = fast === lead ? rival : lead, sc = duelOf(fast, slow, fast.bestRun, slow.bestRun, "Best runs, side by side");
      add("versus", fast.name + " v " + slow.name, sc, "If we put the best runs of " + fast.name + " and " + slow.name + " side by side, as if they had happened in the same race, " + fast.name + " finish " + thou(Math.abs(fast.bestRun.total - slow.bestRun.total)) + " ahead. At the line they would be split by about " + cm(sc.gapCm) + "."
        + (steady && steady.id === slow.id ? " But " + slow.name + " have the smaller spread of times, so the question for the knockouts is which matters more: one fast run, or the same run every time." : ""));
      add("radar", "How they compare", {kind: "radar", eyebrow: "Where each car sits in the field", a: {id: fast.id, values: fast.radar}, b: {id: slow.id, values: slow.radar}},
        "Here is how the two compare across the whole picture. Each spoke is where the team sits in the field, with the outside edge being the best. " + strengths(fast) + " " + strengths(slow)); }
    // 7. the whole field
    if (split && list.length >= 4) add("field", "The whole field", {kind: "field", xUnit: "sec", xLabel: "← QUICKER START · BEST REACTION (SECONDS)", yLabel: "← QUICKER CAR · BEST TIME", eyebrow: "Reaction against " + label, points: list.filter(t => t.react != null).map(t => ({id: t.id, x: t.react, y: t.best})), mark: [lead.id].concat(reactors[0] && reactors[0].id !== lead.id ? [reactors[0].id] : [])},
      "And this is the whole field in one picture. Left to right is the driver's best reaction, top to bottom is the car's best time on the track. The bottom left corner is where everyone wants to be: a quick car and a quick start. " + lead.name + " have the fastest car" + (reactors[0] && reactors[0].id !== lead.id ? ", " + reactors[0].name + " the fastest start" : " and the fastest start") + ". In a knockout it is the two added together that decides who goes through.");
    // 8 and 9. the shape of the cars, from scrutineering
    const shape = (key, id, title, unit, xLabel, intro, why, noun) => { const ps = list.filter(t => t[key] != null).map(t => ({id: t.id, x: t[key], y: t.best})); if (ps.length < 4) return;
      const f = fitLine(ps), lo = ps.reduce((a, b) => a.x <= b.x ? a : b), hi = ps.reduce((a, b) => a.x >= b.x ? a : b), xs = ps.map(p => p.x).sort((a, b) => a - b), mid = xs[Math.floor(xs.length / 2)];
      // the car doing best against the trend among the bigger half of the field
      const big = ps.filter(p => p.x >= mid).map(p => ({p, d: p.y - (f.m * p.x + f.c)})).sort((a, b) => a.d - b.d)[0];
      const trend = f.r > 0.25 ? "And in this field the trend holds: the " + noun[0] + " the car, the slower the time." : f.r < -0.25 ? "In this field it actually goes the other way: the " + noun[0] + " cars are the quicker ones." : "In this field, " + noun[1] + " on its own makes little difference to the time.";
      const fx = v => unit === "mm" ? v.toFixed(1) + " millimetres" : v.toFixed(1) + " square centimetres";
      add(id, title, {kind: "field", xUnit: unit, xLabel, yLabel: "← QUICKER CAR · BEST TIME", eyebrow: title + " against " + label, points: ps, mark: big && big.d < 0 ? [big.p.id] : [lead.id], trend: {x0: lo.x, y0: f.m * lo.x + f.c, x1: hi.x, y1: f.m * hi.x + f.c}},
        intro + " In this field it runs from " + fx(lo.x) + " for " + name(lo.id) + " to " + fx(hi.x) + " for " + name(hi.id) + ". " + why + " " + trend
        + (big && big.d < -1 ? " The car to look at is " + name(big.p.id) + ". At " + fx(big.p.x) + " they are in the " + noun[0] + " half of the field, yet they are " + thou(-big.d) + " quicker than the trend says they should be. Definitely something to ask them about." : "")); };
    shape("width", "width", "Car width", "mm", "CAR WIDTH (MILLIMETRES) · WIDER →", "Now to the cars themselves. Scrutineering measured the total width of every car.",
      "A wider car needs less sideways movement before it meets the lane walls, and it usually carries more frontal area, which means more drag.", ["wider", "width"]);
    shape("env", "envelope", "Frontal envelope", "cm2", "WIDTH × HEIGHT (SQUARE CENTIMETRES) · BIGGER →", "Aerodynamic drag is the car's frontal area multiplied by its drag coefficient. We do not have the true frontal area, but multiplying width by height gives the frontal envelope, the box the car has to push through the air.",
      "Make that box smaller and the drag comes down, whatever else the shape is doing.", ["bigger", "the size of that box"]);
    out.sized = list.filter(t => t.width != null).length;
    out.script = stories.map(s => s.title.toUpperCase() + "\n" + s.script).join("\n\n");
    return out;
    function strengths(t) { const v = t.radar.filter(x => x[1] != null).sort((a, b) => b[1] - a[1]); if (!v.length) return "";
      return t.name + " are strongest on " + v[0][0].toLowerCase() + (v.length > 1 ? " and have most to find on " + v[v.length - 1][0].toLowerCase() : "") + "."; }
  }
  // scenes asked for by hand from the control page
  function duel(an, a, b) { const A = an.teams[a], B = an.teams[b]; if (!A || !B || !A.bestRun || !B.bestRun) return null; const ra = A.bestRun, rb = B.bestRun;
    return {kind: "duel", title: A.name + " v " + B.name, eyebrow: "Best runs, side by side", a: {id: a, total: ra.total, reaction: ra.reaction, t: ra.t}, b: {id: b, total: rb.total, reaction: rb.reaction, t: rb.t},
      gapMs: Math.abs(ra.total - rb.total), gapCm: gapCm(Math.min(ra.total, rb.total), Math.max(ra.total, rb.total))}; }
  function radar(an, a, b) { const A = an.teams[a], B = b && b !== a ? an.teams[b] : null; if (!A || !A.radar) return null;
    return {kind: "radar", title: B && B.radar ? A.name + " v " + B.name : A.name, eyebrow: "Where each car sits in the field", a: {id: a, values: A.radar}, b: B && B.radar ? {id: b, values: B.radar} : null}; }
  function runs(an, a) { const A = an.teams[a]; if (!A || !A.count) return null;
    return {kind: "runs", title: A.name, eyebrow: "Every run", team: a, runs: A.runs.map(r => ({code: r.code, ms: r.t})), best: A.best, spread: A.spread, gain: A.gain, mean: A.mean, fieldBest: an.ranked[0].best}; }
  root.SRIAnalysis = {build, duel, radar, runs, TRACK};
})(typeof window !== "undefined" ? window : globalThis);
