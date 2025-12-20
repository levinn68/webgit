function fmtBytes(bytes) {
  const units = ["B","KB","MB","GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i===0?0:1)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function makeTree(paths) {
  const root = { children: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const last = i === parts.length - 1;
      if (last) node.files.push(part);
      else {
        if (!node.children.has(part)) node.children.set(part, { children:new Map(), files:[] });
        node = node.children.get(part);
      }
    }
  }
  return root;
}

function renderTree(container, paths) {
  const MAX_LINES = 500;
  let shown = 0;

  const tree = makeTree(paths);

  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "px-2 py-2 text-sm";
  container.appendChild(wrap);

  const header = document.createElement("div");
  header.className = "px-3 py-2 text-xs text-slate-500";
  header.textContent = `Showing: ${paths.length} file(s)`;
  wrap.appendChild(header);

  function folderRow(name, depth, open) {
    const row = document.createElement("div");
    row.className = "flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-slate-900/40 cursor-pointer select-none";
    row.dataset.open = open ? "1" : "0";
    row.style.paddingLeft = (depth * 14 + 8) + "px";
    row.innerHTML = `
      <span class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/40 text-slate-200">${open ? "▾" : "▸"}</span>
      <span class="font-medium text-slate-200">${escapeHtml(name)}</span>
      <span class="ml-auto text-xs text-slate-500">folder</span>
    `;
    return row;
  }

  function fileRow(name, depth) {
    const row = document.createElement("div");
    row.className = "flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-slate-900/40";
    row.style.paddingLeft = (depth * 14 + 44) + "px";
    row.innerHTML = `
      <span class="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/40 text-slate-200">·</span>
      <span class="text-slate-200">${escapeHtml(name)}</span>
      <span class="ml-auto text-xs text-slate-600">file</span>
    `;
    return row;
  }

  function walk(node, depth, parentEl) {
    const entries = Array.from(node.children.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
    for (const [fname, child] of entries) {
      if (shown >= MAX_LINES) return;

      const row = folderRow(fname, depth, true);
      const content = document.createElement("div");
      content.className = "folder-content";

      parentEl.appendChild(row);
      parentEl.appendChild(content);

      row.addEventListener("click", () => {
        const isOpen = row.dataset.open === "1";
        row.dataset.open = isOpen ? "0" : "1";
        row.querySelector("span").textContent = isOpen ? "▸" : "▾";
        content.style.display = isOpen ? "none" : "block";
      });

      walk(child, depth + 1, content);
    }

    const files = node.files.slice().sort((a,b)=>a.localeCompare(b));
    for (const f of files) {
      if (shown >= MAX_LINES) return;
      parentEl.appendChild(fileRow(f, depth));
      shown++;
    }
  }

  walk(tree, 0, wrap);

  if (shown >= MAX_LINES) {
    const note = document.createElement("div");
    note.className = "px-3 py-3 text-xs text-slate-500";
    note.textContent = `Preview dibatasi ${MAX_LINES} baris.`;
    wrap.appendChild(note);
  }
}

export async function readZipAndPreview({ file, els }) {
  if (!window.JSZip) throw new Error("JSZip tidak ke-load.");

  const { zipName, zipSize, zipFiles, zipTop, previewStatus, treeWrap } = els;

  zipName.textContent = file.name;
  zipSize.textContent = fmtBytes(file.size);
  zipFiles.textContent = "—";
  zipTop.textContent = "—";

  previewStatus.textContent = "Loading…";
  treeWrap.innerHTML = `<div class="px-3 py-6 text-center text-sm text-slate-500">Reading ZIP…</div>`;

  const buf = await file.arrayBuffer();
  const zip = await window.JSZip.loadAsync(buf);

  const paths = [];
  const topSet = new Set();
  let fileCount = 0;

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    fileCount++;
    const p = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!p || p.startsWith(".git/")) return;
    paths.push(p);
    const first = p.split("/")[0];
    if (first) topSet.add(first);
  });

  paths.sort((a,b)=>a.localeCompare(b));
  const topFolders = Array.from(topSet).slice(0, 6);

  zipFiles.textContent = String(fileCount);
  zipTop.textContent = topFolders.length ? topFolders.join(", ") : "—";
  previewStatus.textContent = `Loaded • ${fileCount} files`;

  renderTree(treeWrap, paths);

  return {
    file,
    fileCount,
    paths,
    previewed: true,
    topFolders
  };
}
