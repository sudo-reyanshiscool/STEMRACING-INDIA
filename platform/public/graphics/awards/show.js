// Turns the award list into the running order. Used by both the control window and the big screen.
window.buildSteps = function () {
  const CYCLE = ["blue", "cold", "pink-orange", "green", "full-range", "blue-green", "hot"];
  const S = window.SHOW, steps = [];
  if (S.holding) steps.push({kind: "idle", label: S.holding, bg: "sr", dark: 0.12});
  steps.push({kind: "seats", label: S.seats, bg: "sr", dark: 0.12});
  if (S.videos) steps.push({kind: "hold", label: S.videos + " (placeholder)", bg: "sr", dark: 0.12});
  steps.push({kind: "title", label: "Title: " + S.title, bg: "sr", dark: 0.12});
  if (S.presenter) steps.push({kind: "presenter", label: "Presenter: " + S.presenter.name, bg: "sr", dark: 0.3});
  window.AWARDS.forEach((a, k) => {
    const bg = a.bg || CYCLE[k % CYCLE.length];
    if (a.race) steps.push({kind: "card", label: a.race + " (raced live)", title: a.race, small: a.raceSmall || "", bg, dark: 0.35});
    steps.push({kind: "award", label: "Announce: " + a.name, award: a, bg, dark: a.place ? 0.8 : 0.4});
    if (a.nominees !== false) steps.push({kind: "nominees", label: "Nominees: " + a.name, award: a, bg, dark: 0.5});
    steps.push({kind: "winner", label: "Winner: " + a.name, award: a, bg, dark: a.top ? 0.3 : 0.55});
    steps.push({kind: "photo", label: "Photo: " + a.name, award: a, bg, dark: 0.62});
  });
  steps.push({kind: "close", label: "Close: " + S.close, bg: "sr", dark: 0.12});
  return steps;
};

// A soft synthesised heartbeat (lub-dub every 1.5 s) for the Regional Champions build-up.
// It plays from whichever window the operator is pressing keys in, because browsers only allow sound there.
window.SRHeart = (function () {
  let ac = null, master = null, timer = 0, next = 0;
  function thump(t, vol, f) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.16);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
  }
  function sched() {
    while (next < ac.currentTime + 0.6) {
      thump(next + 0.12, 0.5, 95); thump(next + 0.12, 0.3, 150);
      thump(next + 0.42, 0.32, 80); thump(next + 0.42, 0.18, 130);
      next += 1.5;
    }
  }
  return {
    start: function (delay) {
      this.stop();
      try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) { return; }
      master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
      next = ac.currentTime + (delay || 0); sched(); timer = setInterval(sched, 200);
    },
    stop: function () {
      clearInterval(timer); timer = 0;
      if (master && ac) { try { master.gain.setTargetAtTime(0, ac.currentTime, 0.04); } catch (e) {} master = null; }
    }
  };
})();
