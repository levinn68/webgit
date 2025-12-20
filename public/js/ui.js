export function toast(hostEl, msg, type="info") {
  const colors = {
    info: "border-slate-800 bg-slate-950/80 text-slate-200",
    ok: "border-emerald-800/70 bg-emerald-500/10 text-emerald-100",
    err:"border-rose-800/70 bg-rose-500/10 text-rose-100"
  };
  const dot = type==="ok" ? "bg-emerald-400" : type==="err" ? "bg-rose-400" : "bg-slate-400";

  const el = document.createElement("div");
  el.className = `rounded-2xl border px-4 py-3 text-sm shadow-sm backdrop-blur-xl ${colors[type] || colors.info}`;
  el.innerHTML = `<div class="flex items-start gap-3">
    <div class="mt-0.5 h-2 w-2 rounded-full ${dot}"></div>
    <div class="leading-snug">${msg}</div>
  </div>`;
  hostEl.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "all .18s ease";
    setTimeout(() => el.remove(), 220);
  }, 2400);
}

export function setRun({ runDot, runText, runHint, runBar }, state, hint, pct) {
  const map = {
    idle: ["bg-slate-500", "bg-indigo-500", 0],
    ready:["bg-cyan-400", "bg-indigo-500", 10],
    working:["bg-amber-400", "bg-emerald-500", 40],
    pushing:["bg-cyan-400", "bg-indigo-500", 85],
    success:["bg-emerald-400", "bg-emerald-500", 100],
    error:["bg-rose-400", "bg-rose-500", 100]
  };
  const [dot, bar, defPct] = map[state] || map.idle;
  runDot.className = "inline-block h-1.5 w-1.5 rounded-full " + dot;
  runText.textContent = state;
  runHint.textContent = hint || "";
  runBar.className = "h-full transition-all " + bar;
  runBar.style.width = (pct ?? defPct) + "%";
}

export function setCfgPill({ cfgPill, cfgPillDot, cfgPillText, cfgDot, cfgText, currentCfg }, applied, cfgStr) {
  cfgPill.classList.remove("hidden");
  cfgPillDot.className = "inline-block h-1.5 w-1.5 rounded-full " + (applied ? "bg-emerald-400" : "bg-slate-500");
  cfgPillText.textContent = cfgStr;

  cfgDot.className = "inline-block h-1.5 w-1.5 rounded-full " + (applied ? "bg-emerald-400" : "bg-slate-500");
  cfgText.textContent = applied ? "applied" : "not applied";

  currentCfg.textContent = cfgStr;
}

export function togglePrivateUI({ btn, knob }, on) {
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.className = "relative inline-flex h-8 w-14 items-center rounded-full transition " + (on ? "bg-indigo-500" : "bg-slate-700");
  knob.className = "inline-block h-6 w-6 transform rounded-full bg-white transition " + (on ? "translate-x-7" : "translate-x-1");
}

export function refreshChecks({ chkCfg, chkZip, chkKey, checksBadge, deployBtn }, { cfgApplied, zipReady, keyReady }) {
  chkCfg.className = "h-2 w-2 rounded-full " + (cfgApplied ? "bg-emerald-400" : "bg-slate-600");
  chkZip.className = "h-2 w-2 rounded-full " + (zipReady ? "bg-emerald-400" : "bg-slate-600");
  chkKey.className = "h-2 w-2 rounded-full " + (keyReady ? "bg-emerald-400" : "bg-slate-600");

  const score = [cfgApplied, zipReady, keyReady].filter(Boolean).length;
  checksBadge.textContent = `${score}/3`;

  deployBtn.disabled = !(cfgApplied && zipReady && keyReady);
}
