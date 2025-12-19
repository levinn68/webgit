import Busboy from "busboy";
import JSZip from "jszip";
import { assertDeployKey } from "./_lib/auth.js";
import {
  ensureRepo, getDefaultBranch, getRefSha, createBranch,
  getCommit, createBlob, createTree, createCommitObj, updateRef
} from "./_lib/gh.js";

function toB64(buf) {
  return Buffer.from(buf).toString("base64");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    assertDeployKey(req);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const repo = url.searchParams.get("repo");
    const branch = url.searchParams.get("branch") || "main";
    const makePrivate = (url.searchParams.get("private") || "true") === "true";

    if (!repo) return res.status(400).json({ error: "Missing ?repo=" });

    await ensureRepo({ repo, makePrivate });

    // Parse multipart form-data (field name: zip)
    const bb = Busboy({
      headers: req.headers,
      limits: { files: 1 } // Vercel payload limit still applies
    });

    let zipBuf = null;

    await new Promise((resolve, reject) => {
      bb.on("file", (name, file, info) => {
        const chunks = [];
        file.on("data", (d) => chunks.push(d));
        file.on("end", () => { zipBuf = Buffer.concat(chunks); });
        file.on("error", reject);
      });
      bb.on("finish", resolve);
      bb.on("error", reject);
      req.pipe(bb);
    });

    if (!zipBuf) return res.status(400).json({ error: "No zip file found (field: zip)" });

    // Unzip and gather files
    const zip = await JSZip.loadAsync(zipBuf);

    const files = [];
    const warnings = [];

    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const p = path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!p) return;
      if (p.startsWith(".git/")) return;

      files.push({ path: p, entry });

      const lower = p.toLowerCase();
      if (
        lower === ".env" || lower.endsWith("/.env") ||
        lower.includes("id_rsa") ||
        lower.includes("private_key") ||
        lower.includes("serviceaccount") ||
        lower.endsWith(".p12")
      ) {
        warnings.push(`Sensitive-looking file: ${p}`);
      }
    });

    if (!files.length) return res.status(400).json({ error: "ZIP contains no files" });

    // Guard biar nggak kebablasan di serverless
    const MAX_FILES = 1200;
    if (files.length > MAX_FILES) {
      return res.status(413).json({ error: `Too many files (${files.length}). Limit ${MAX_FILES}.` });
    }

    // Resolve base commit (create branch if missing)
    let baseSha;
    try {
      baseSha = await getRefSha(repo, branch);
    } catch (e) {
      if (e.statusCode !== 404) throw e;
      const def = await getDefaultBranch(repo);
      const defSha = await getRefSha(repo, def);
      await createBranch(repo, branch, defSha);
      baseSha = await getRefSha(repo, branch);
    }

    const baseCommit = await getCommit(repo, baseSha);
    const baseTreeSha = baseCommit.tree.sha;

    // Create blobs and tree entries
    const treeEntries = [];

    for (const f of files) {
      const content = await f.entry.async("nodebuffer");
      const blob = await createBlob(repo, toB64(content));
      treeEntries.push({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha
      });
    }

    // Create new tree and commit, then update ref
    const newTree = await createTree(repo, baseTreeSha, treeEntries);
    const msg = `Deploy from WebGit (${new Date().toISOString()})`;
    const newCommit = await createCommitObj(repo, msg, newTree.sha, baseSha);

    await updateRef(repo, branch, newCommit.sha);

    return res.status(200).json({
      ok: true,
      owner: process.env.GITHUB_OWNER,
      repo,
      branch,
      files: files.length,
      commit: newCommit.sha,
      warnings
    });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message, details: e.details });
  }
}
