const $ = (id) => document.getElementById(id);
const state = { mode: "existing", repos: [], page: 1, hasMore: false, selected: null, file: null, paths: [], busy: false, toastTimer: null };
const terminal = $("terminalLines");
const savedAccessKey = sessionStorage.getItem("webgit_access_key") || "";
if (!savedAccessKey) location.replace("/");
else $("deployKey").value = savedAccessKey;

function escapeText(value) { return String(value ?? ""); }
function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(2) + " MB";
}
function password() {
  const value = $("deployKey").value.trim();
  if (!value) throw new Error("Masukkan workspace password terlebih dahulu.");
  return value;
}
function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function log(message, level = "INFO", time) {
  const row = document.createElement("div");
  row.className = "log-row";
  const timeEl = document.createElement("span");
  timeEl.className = "log-time";
  timeEl.textContent = time || new Date().toLocaleTimeString("id-ID", { hour12: false });
  const levelEl = document.createElement("span");
  levelEl.className = "log-level " + String(level).toLowerCase();
  levelEl.textContent = level.toUpperCase().slice(0, 8);
  const messageEl = document.createElement("span");
  messageEl.className = "log-message";
  messageEl.textContent = escapeText(message);
  row.append(timeEl, levelEl, messageEl);
  terminal.appendChild(row);
  terminal.scrollTop = terminal.scrollHeight;
}
function setProgress(value, label) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  $("bar").style.width = pct + "%";
  $("progressValue").textContent = Math.round(pct) + "%";
  $("progressLabel").textContent = label || "PROCESS STATUS";
  $("progressTrack").setAttribute("aria-valuenow", String(Math.round(pct)));
}
function setBusy(busy) {
  state.busy = busy;
  $("upload").disabled = busy || !state.file || !state.selected || !validBranch();
  $("upload").innerHTML = busy ? "Processing upload <span>…</span>" : "Upload project to GitHub <span>↗</span>";
  $("createRepoBtn").disabled = busy;
  $("modeExisting").disabled = busy;
  $("modeCreate").disabled = busy;
}
function validBranch() {
  const value = $("branch").value.trim();
  return /^[A-Za-z0-9._/-]+$/.test(value) && !value.includes("..") && !value.startsWith("/") && !value.endsWith("/");
}
function refreshUploadButton() {
  $("upload").disabled = state.busy || !state.file || !state.selected || !passwordPresent() || !validBranch();
}
function passwordPresent() { return Boolean($("deployKey").value.trim()); }
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}), "x-deploy-key": password() };
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "Request gagal (" + response.status + ").");
  return data;
}

function setMode(mode) {
  state.mode = mode;
  $("existingPanel").classList.toggle("hidden", mode !== "existing");
  $("createPanel").classList.toggle("hidden", mode !== "create");
  $("modeExisting").setAttribute("aria-pressed", String(mode === "existing"));
  $("modeCreate").setAttribute("aria-pressed", String(mode === "create"));
  refreshUploadButton();
}
function renderSelectedRepo(repo) {
  const wrapper = document.createElement("span");
  wrapper.className = "repo-selected";
  const avatar = document.createElement("span");
  avatar.className = "repo-avatar";
  avatar.textContent = (repo.name || "R").slice(0, 1).toUpperCase();
  const text = document.createElement("span");
  const name = document.createElement("span");
  name.className = "repo-title";
  name.textContent = repo.full_name;
  const meta = document.createElement("span");
  meta.className = "repo-meta";
  meta.textContent = (repo.private ? "PRIVATE" : "PUBLIC") + " · " + (repo.default_branch || "NO DEFAULT BRANCH");
  text.append(name, meta);
  wrapper.append(avatar, text);
  $("selectedRepoText").replaceChildren(wrapper);
}
function selectRepo(repo) {
  state.selected = repo;
  renderSelectedRepo(repo);
  $("repoInfo").classList.remove("hidden");
  $("repoInfo").textContent = repo.full_name + "  /  " + (repo.permissions && repo.permissions.push === false ? "NO PUSH ACCESS" : "PUSH ACCESS") + "  /  DEFAULT: " + (repo.default_branch || "EMPTY");
  if (repo.default_branch) $("branch").value = repo.default_branch;
  $("repoPicker").setAttribute("aria-expanded", "false");
  $("repoMenu").classList.add("hidden");
  refreshUploadButton();
}
function renderRepos() {
  const query = $("repoSearch").value.trim().toLowerCase();
  const filtered = state.repos.filter(repo => repo.full_name.toLowerCase().includes(query));
  const list = $("repoList");
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "repo-empty";
    empty.textContent = state.repos.length ? "Tidak ada repository yang cocok." : "Belum ada repository. Periksa password atau refresh.";
    list.appendChild(empty);
  }
  for (const repo of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "repo-option";
    const left = document.createElement("span");
    const name = document.createElement("span");
    name.className = "repo-option-name";
    name.textContent = repo.name;
    const sub = document.createElement("span");
    sub.className = "repo-option-sub";
    sub.textContent = repo.full_name;
    left.append(name, sub);
    const visibility = document.createElement("span");
    visibility.className = "visibility";
    visibility.textContent = repo.private ? "PRIVATE" : "PUBLIC";
    button.append(left, visibility);
    button.addEventListener("click", () => selectRepo(repo));
    list.appendChild(button);
  }
  $("loadMoreRepos").classList.toggle("hidden", !state.hasMore || Boolean(query));
}
async function loadRepos(reset = true) {
  try {
    $("repoList").innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "repo-empty";
    loading.textContent = "Memuat repository dari GitHub…";
    $("repoList").appendChild(loading);
    if (reset) { state.repos = []; state.page = 1; }
    const data = await api("/api/repos?page=" + state.page);
    const existing = new Set(state.repos.map(repo => repo.full_name));
    state.repos.push(...data.repos.filter(repo => !existing.has(repo.full_name)));
    state.hasMore = data.hasMore;
    renderRepos();
    log(state.repos.length + " repositories loaded", "SUCCESS");
  } catch (error) {
    $("repoList").replaceChildren();
    const message = document.createElement("div");
    message.className = "repo-empty";
    message.textContent = error.message;
    $("repoList").appendChild(message);
    log(error.message, "ERROR");
  }
}
function makeTree(paths) {
  const root = { dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) node.files.push(part);
      else {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
        node = node.dirs.get(part);
      }
    }
  }
  return root;
}
function renderTree(paths) {
  const root = makeTree(paths);
  const container = $("tree");
  container.replaceChildren();
  function walk(node, parent, depth) {
    const dirs = Array.from(node.dirs.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, child] of dirs) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tree-row folder";
      row.style.paddingLeft = (8 + depth * 13) + "px";
      const glyph = document.createElement("span");
      glyph.className = "tree-glyph";
      glyph.textContent = "▾";
      const label = document.createElement("span");
      label.className = "tree-path";
      label.textContent = name;
      const count = document.createElement("span");
      count.className = "tree-count";
      count.textContent = "DIR";
      row.append(glyph, label, count);
      const children = document.createElement("div");
      children.className = "tree-children";
      walk(child, children, depth + 1);
      row.addEventListener("click", () => {
        const open = children.hidden;
        children.hidden = !open;
        glyph.textContent = open ? "▾" : "▸";
      });
      parent.append(row, children);
    }
    for (const name of node.files.slice().sort((a, b) => a.localeCompare(b))) {
      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.paddingLeft = (8 + depth * 13) + "px";
      const glyph = document.createElement("span");
      glyph.className = "tree-glyph";
      glyph.textContent = "·";
      const label = document.createElement("span");
      label.className = "tree-path";
      label.textContent = name;
      row.append(glyph, label);
      parent.appendChild(row);
    }
  }
  walk(root, container, 0);
}
async function inspectZip(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("File harus berformat .zip.");
  if (file.size > 4 * 1024 * 1024) throw new Error("Ukuran ZIP melebihi batas 4 MB.");
  if (!window.JSZip) throw new Error("ZIP reader gagal dimuat. Refresh halaman.");
  $("status").textContent = "READING ARCHIVE";
  $("tree").textContent = "Membaca struktur ZIP…";
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const paths = [];
  let expanded = 0;
  for (const [rawPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const path = rawPath.replace(/\\/g, "/");
    if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) {
      throw new Error("ZIP memiliki path yang tidak aman: " + rawPath);
    }
    if (path.startsWith(".git/")) continue;
    paths.push(path);
    expanded += Number(entry._data && entry._data.uncompressedSize || 0);
    if (expanded > 18 * 1024 * 1024) throw new Error("Hasil ekstraksi melebihi batas 18 MB.");
  }
  if (!paths.length) throw new Error("ZIP tidak berisi file yang dapat diunggah.");
  if (paths.length > 400) throw new Error("Maksimal 400 file per upload.");
  paths.sort((a, b) => a.localeCompare(b));
  state.file = file;
  state.paths = paths;
  $("filename").textContent = file.name + " · " + fmtBytes(file.size);
  $("count").textContent = String(paths.length);
  $("size").textContent = fmtBytes(expanded);
  $("status").textContent = "ARCHIVE VALIDATED";
  $("treeCount").textContent = paths.length + " PATHS";
  renderTree(paths);
  log("Archive inspected: " + paths.length + " files, " + fmtBytes(expanded) + " extracted", "SUCCESS");
  refreshUploadButton();
}
function resetResult() {
  $("result").classList.remove("show");
  $("resultMeta").replaceChildren();
}
function showResult(result) {
  const meta = $("resultMeta");
  meta.replaceChildren();
  const lines = [
    "Repository: " + result.owner + "/" + result.repo,
    "Branch: " + result.branch,
    "Files committed: " + result.files,
    "Commit: " + result.commit
  ];
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    meta.appendChild(div);
  }
  const link = document.createElement("a");
  link.href = result.commitUrl || result.url || ("https://github.com/" + result.owner + "/" + result.repo);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Open repository ↗";
  meta.appendChild(link);
  $("result").classList.add("show");
}
async function consumeUpload(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok && !contentType.includes("ndjson")) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Upload request failed (" + response.status + ").");
  }
  if (!contentType.includes("ndjson") || !response.body) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || "Upload gagal.");
    return data;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "log") log(event.message, event.level || "INFO", event.time);
      if (event.type === "progress") setProgress(event.progress, event.label || "UPLOADING");
      if (event.type === "done") finalResult = event.result;
      if (event.type === "error") throw new Error(event.message || "Upload gagal.");
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.type === "done") finalResult = event.result;
    if (event.type === "error") throw new Error(event.message || "Upload gagal.");
  }
  if (!finalResult) throw new Error("Koneksi proses terputus sebelum hasil upload diterima.");
  return finalResult;
}

$("revealKey").addEventListener("click", () => {
  const input = $("deployKey");
  input.type = input.type === "password" ? "text" : "password";
  $("revealKey").textContent = input.type === "password" ? "Show" : "Hide";
});
$("deployKey").addEventListener("input", () => {
  state.repos = [];
  state.selected = null;
  $("selectedRepoText").textContent = "Pilih repository dari akun GitHub";
  refreshUploadButton();
});
$("modeExisting").addEventListener("click", () => setMode("existing"));
$("modeCreate").addEventListener("click", () => setMode("create"));
$("repoPicker").addEventListener("click", async () => {
  const expanded = $("repoPicker").getAttribute("aria-expanded") === "true";
  $("repoPicker").setAttribute("aria-expanded", String(!expanded));
  $("repoMenu").classList.toggle("hidden", expanded);
  if (!expanded && !state.repos.length) await loadRepos(true);
});
$("repoSearch").addEventListener("input", renderRepos);
$("refreshRepos").addEventListener("click", () => loadRepos(true));
$("loadMoreRepos").addEventListener("click", async () => {
  state.page += 1;
  await loadRepos(false);
});
$("branch").addEventListener("input", refreshUploadButton);
$("createRepoBtn").addEventListener("click", async () => {
  try {
    const name = $("newRepoName").value.trim();
    if (!name) throw new Error("Nama repository wajib diisi.");
    $("createRepoBtn").disabled = true;
    $("createRepoBtn").textContent = "Creating…";
    const data = await api("/api/create-repo", {
      method: "POST",
      body: JSON.stringify({ name, description: $("newRepoDescription").value.trim(), isPrivate: $("newRepoPrivate").checked })
    });
    const repo = { ...data.repo, permissions: { push: true } };
    state.repos.unshift(repo);
    selectRepo(repo);
    setMode("existing");
    log("Repository created: " + repo.full_name, "SUCCESS");
    toast("Repository berhasil dibuat.");
  } catch (error) {
    log(error.message, "ERROR");
    toast(error.message, true);
  } finally {
    $("createRepoBtn").disabled = false;
    $("createRepoBtn").textContent = "＋ Create repository";
  }
});
$("zip").addEventListener("change", async event => {
  resetResult();
  try {
    await inspectZip(event.target.files && event.target.files[0]);
  } catch (error) {
    state.file = null;
    state.paths = [];
    $("filename").textContent = "";
    $("count").textContent = "0";
    $("size").textContent = "0 B";
    $("status").textContent = "INVALID ARCHIVE";
    $("tree").textContent = error.message;
    refreshUploadButton();
    log(error.message, "ERROR");
    toast(error.message, true);
  }
});
$("drop").addEventListener("dragover", event => { event.preventDefault(); $("drop").classList.add("drag"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("drag"));
$("drop").addEventListener("drop", async event => {
  event.preventDefault();
  $("drop").classList.remove("drag");
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  $("zip").files = event.dataTransfer.files;
  resetResult();
  try { await inspectZip(file); }
  catch (error) { state.file = null; refreshUploadButton(); log(error.message, "ERROR"); toast(error.message, true); }
});
$("copyLogsBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(Array.from(terminal.querySelectorAll(".log-row")).map(row => row.innerText).join("\n"));
    toast("Activity log copied.");
  } catch { toast("Clipboard tidak tersedia di browser ini.", true); }
});
$("upload").addEventListener("click", async () => {
  try {
    if (!state.selected) throw new Error("Pilih repository tujuan.");
    if (!state.file) throw new Error("Pilih ZIP archive.");
    if (!validBranch()) throw new Error("Nama branch tidak valid.");
    password();
    resetResult();
    setBusy(true);
    terminal.replaceChildren();
    log("Upload job started", "INFO");
    setProgress(4, "VALIDATING REQUEST");
    $("badge").textContent = "RUNNING";
    $("status").textContent = "UPLOADING";
    const body = new FormData();
    body.append("zip", state.file, state.file.name);
    body.append("message", $("message").value.trim() || "Upload project files");
    const query = new URLSearchParams({ repo: state.selected.full_name, branch: $("branch").value.trim() });
    const response = await fetch("/api/upload?" + query.toString(), {
      method: "POST",
      headers: { "x-deploy-key": password() },
      body
    });
    const result = await consumeUpload(response);
    setProgress(100, "COMMIT COMPLETED");
    $("badge").textContent = "COMPLETE";
    $("status").textContent = "COMMITTED";
    showResult(result);
    log("Commit " + result.commit, "SUCCESS");
    toast("Project berhasil dikirim ke GitHub.");
  } catch (error) {
    $("badge").textContent = "FAILED";
    $("status").textContent = "UPLOAD FAILED";
    log(error.message, "ERROR");
    toast(error.message, true);
  } finally {
    setBusy(false);
  }
});

setMode("existing");
log("Workspace ready. Unlock to continue.", "READY");
