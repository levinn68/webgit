import { initTerminal, writeln, clearLogs, getLogsText } from "./terminal.js";
import { readZipAndPreview, applyFilter } from "./zipPreview.js";
import { toast, setRun, setCfgPill, togglePrivateUI, refreshChecks } from "./ui.js";

const els = {
  // terminal
  terminal: document.getElementById("terminal"),
  copyLogsBtn: document.getElementById("copyLogsBtn"),
  clearBtn: document.getElementById("clearBtn"),

  runDot: document.getElementById("runDot"),
  runText: document.getElementById("runText"),
  runHint: document.getElementById("runHint"),
  runBar: document.getElementById("runBar"),

  // config
  repoInput: document.getElementById("repoInput"),
  repoHint: document.getElementById("repoHint"),
  branchInput: document.getElementById("branchInput"),
  deployKeyInput: document.getElementById("deployKeyInput"),
  revealKeyBtn: document.getElementById("revealKeyBtn"),
  applyBtn: document.getElementById("applyBtn"),
  privateToggle: document.getElementById("privateToggle"),
  toggleKnob: document.getElementById("toggleKnob"),

  cfgPill: document.getElementById("cfgPill"),
  cfgPillDot: document.getElementById("cfgPillDot"),
  cfgPillText: document.getElementById("cfgPillText"),
  cfgDot: document.getElementById("cfgDot"),
  cfgText: document.getElementById("cfgText"),
  currentCfg: document.getElementById("currentCfg"),

  // zip
  zipInput: document.getElementById("zipInput"),
  zipName: document.getElementById("zipName"),
  zipSize: document.getElementById("zipSize"),
  zipFiles: document.getElementById("zipFiles"),
  zipTop: document.getElementById("zipTop"),
  filterInput: document.getElementById("filterInput"),
  filterHint: document.getElementById("filterHint"),
  previewStatus: document.getElementById("previewStatus"),
  treeWrap: document.getElementById("treeWrap"),
  expandAllBtn: document.getElementById("expandAllBtn"),
  collapseAllBtn: document.getElementById("collapseAllBtn"),

  // checks + deploy
  chkCfg: document.getElementById("chkCfg"),
  chkZip: document.getElementById("chkZip"),
  chkKey: document.getElementById("chkKey"),
  checksBadge: document.getElementById("checksBadge"),
  deployBtn: document.getElementById("deployBtn"),

  toastHost: document.getElementById("toastHost"),
};

const runEls = { runDot: els.runDot, runText: els.runText, runHint: els.runHint, runBar: els.runBar };

const repoRe = /^[a-zA-Z0-9._-]+$/;

const state = {
  cfgApplied: false,
  makePrivate: true,
  zipMeta: { previewed: false, file: null, paths: [] }
};

initTerminal(els.terminal);
setRun(runEls, "idle", "Siap.", 0);
togglePrivateUI({ btn: els.privateToggle, knob: els.toggleKnob }, true);

function getDeployKeyOrThrow() {
  const k = (els.deployKeyInput.value || "").trim();
  if (!k) throw new Error("Deploy key belum diisi.");
  return k;
}

function updateChecks() {
  refreshChecks(
    {
      chkCfg: els.chkCfg,
      chkZip: els.chkZip,
      chkKey: els.chkKey,
      checksBadge: els.checksBadge,
      deployBtn: els.deployBtn
    },
    {
      cfgApplied: state.cfgApplied,
      zipReady: !!state.zipMeta.previewed,
      keyReady: (els.deployKeyInput.value || "").trim().length > 0
    }
  );
}

updateChecks();

els.deployKeyInput.addEventListener("input", updateChecks);

els.revealKeyBtn.addEventListener("click", () => {
  const isPw = els.deployKeyInput.type === "password";
  els.deployKeyInput.type = isPw ? "text" : "password";
  els.revealKeyBtn.textContent = isPw ? "hide" : "show";
});

els.repoInput.addEventListener("input", () => {
  const v = els.repoInput.value.trim();
  if (!v) {
    els.repoHint.textContent = "Format: a-z 0-9 . _ -";
    els.repoHint.className = "mt-1 text-xs text-slate-500";
    return;
  }
  if (repoRe.test(v)) {
    els.repoHint.textContent = "Looks good ✓";
    els.repoHint.className = "mt-1 text-xs text-emerald-300";
  } else {
    els.repoHint.textContent = "Invalid (pakai a-z 0-9 . _ -)";
    els.repoHint.className = "mt-1 text-xs text-rose-300";
  }
});

els.privateToggle.addEventListener("click", () => {
  state.makePrivate = !state.makePrivate;
  togglePrivateUI({ btn: els.privateToggle, knob: els.toggleKnob }, state.makePrivate);
  toast(els.toastHost, `Set repo: ${state.makePrivate ? "PRIVATE" : "PUBLIC"}`, "info");
});

els.clearBtn.addEventListener("click", () => {
  clearLogs();
  toast(els.toastHost, "Terminal cleared", "info");
});

els.copyLogsBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(getLogsText());
    toast(els.toastHost, "Logs copied", "ok");
  } catch {
    toast(els.toastHost, "Gagal copy (izin clipboard)", "err");
  }
});

async function applyConfig() {
  const repo = els.repoInput.value.trim();
  const branch = (els.branchInput.value.trim() || "main").trim();
  const deployKey = getDeployKeyOrThrow();

  if (!repo) throw new Error("Repo name masih kosong.");
  if (!repoRe.test(repo)) throw new Error("Repo name invalid.");

  setRun(runEls, "working", "Applying config…", 18);
  writeln(`$ apply config -> ${repo}#${branch} (${state.makePrivate ? "private" : "public"})`);

  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-deploy-key": deployKey },
    body: JSON.stringify({ repo, branch, makePrivate: state.makePrivate })
  });

  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);

  const cfgStr = `${j.owner}/${j.repo}#${j.branch} (${j.makePrivate ? "private" : "public"})`;
  setCfgPill(
    { cfgPill: els.cfgPill, cfgPillDot: els.cfgPillDot, cfgPillText: els.cfgPillText, cfgDot: els.cfgDot, cfgText: els.cfgText, currentCfg: els.currentCfg },
    true,
    cfgStr
  );

  state.cfgApplied = true;
  updateChecks();

  setRun(runEls, "ready", "Config OK. Pilih ZIP dan deploy.", 22);
  toast(els.toastHost, "Config applied", "ok");
  writeln(`Config OK -> ${cfgStr}`);
}

els.applyBtn.addEventListener("click", () => {
  applyConfig().catch(e => {
    setRun(runEls, "error", e.message, 100);
    toast(els.toastHost, e.message, "err");
    writeln("ERROR: " + e.message);
  });
});

els.zipInput.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;

  // guard: size
  if (f.size > 4.5 * 1024 * 1024) {
    toast(els.toastHost, "ZIP terlalu besar. Maks ~4.5MB.", "err");
    writeln("ERROR: ZIP terlalu besar. Maks ~4.5MB.");
    els.zipInput.value = "";
    return;
  }
  if (!f.name.toLowerCase().endsWith(".zip")) {
    toast(els.toastHost, "File harus .zip", "err");
    writeln("ERROR: File harus .zip");
    els.zipInput.value = "";
    return;
  }

  try {
    const meta = await readZipAndPreview({
      file: f,
      els: {
        zipName: els.zipName,
        zipSize: els.zipSize,
        zipFiles: els.zipFiles,
        zipTop: els.zipTop,
        filterInput: els.filterInput,
        filterHint: els.filterHint,
        previewStatus: els.previewStatus,
        treeWrap: els.treeWrap
      }
    });

    state.zipMeta = meta;
    updateChecks();
    toast(els.toastHost, "ZIP preview ready", "ok");
  } catch (err) {
    state.zipMeta = { previewed: false, file: null, paths: [] };
    updateChecks();
    toast(els.toastHost, err.message || "Gagal baca ZIP", "err");
    writeln("ERROR: " + (err.message || String(err)));
  }
});

els.filterInput.addEventListener("input", () => {
  if (!state.zipMeta.previewed) return;
  applyFilter({ treeWrap: els.treeWrap, paths: state.zipMeta.paths, query: els.filterInput.value.trim() });
});

// deploy (dummy steps, real backend)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function dummySteps() {
  const steps = [
    { pct: 35, state:"working", msg:"Uploading ZIP…" },
    { pct: 55, state:"working", msg:"Extracting package…" },
    { pct: 75, state:"pushing", msg:"Creating commit…" },
    { pct: 90, state:"pushing", msg:"Pushing to GitHub…" }
  ];
  for (const s of steps) {
    setRun(runEls, s.state, s.msg, s.pct);
    writeln(s.msg);
    await sleep(650);
  }
}

els.deployBtn.addEventListener("click", async () => {
  try {
    if (!state.zipMeta.previewed || !state.zipMeta.file) throw new Error("Pilih ZIP dulu.");
    // ensure config applied (create repo + sync visibility di backend kamu)
    if (!state.cfgApplied) await applyConfig();

    const repo = els.repoInput.value.trim();
    const branch = (els.branchInput.value.trim() || "main").trim();
    const deployKey = getDeployKeyOrThrow();

    writeln(`$ deploy -> ${repo}#${branch}`);
    toast(els.toastHost, "Deploy started", "info");

    const fd = new FormData();
    fd.append("zip", state.zipMeta.file, state.zipMeta.file.name);

    const qs = new URLSearchParams({ repo, branch, private: String(state.makePrivate) });

    // run dummy + real request
    const dummyPromise = dummySteps();

    const res = await fetch(`/api/upload?${qs.toString()}`, {
      method: "POST",
      headers: { "x-deploy-key": deployKey },
      body: fd
    });

    const j = await res.json().catch(() => ({}));
    await dummyPromise.catch(() => {});

    if (!res.ok || !j.ok) {
      const msg = j?.error || "Deploy failed";
      setRun(runEls, "error", msg, 100);
      writeln("ERROR: " + msg);
      toast(els.toastHost, msg, "err");
      return;
    }

    setRun(runEls, "success", "Done ✅", 100);
    writeln("✅ SELESAI");
    writeln(`Repo: ${j.owner}/${j.repo}`);
    writeln(`Branch: ${j.branch}`);
    writeln(`Files: ${j.files}`);
    writeln(`Commit: ${j.commit}`);
    toast(els.toastHost, "Deploy success ✅", "ok");
  } catch (e) {
    setRun(runEls, "error", e.message, 100);
    toast(els.toastHost, e.message, "err");
    writeln("ERROR: " + e.message);
  }
});
