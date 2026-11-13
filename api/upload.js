import Busboy from "busboy";
import JSZip from "jszip";
import { assertDeployKey } from "./_lib/auth.js";
import { pushZip } from "./_lib/gh.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    assertDeployKey(req);
    const url = new URL(req.url, "https://" + (req.headers.host || "localhost"));
    const [ownerFromEnv, repoEnv] = (process.env.GITHUB_OWNER || "").split("/");
    const target = url.searchParams.get("repo") || repoEnv;
    const branch = url.searchParams.get("branch") || "main";
    const [owner, repo] = target.includes("/") ? target.split("/") : [ownerFromEnv, target];
    if (!owner || !repo || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
      return res.status(400).json({ error: "Repository harus format owner/name" });
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) return res.status(400).json({ error: "Invalid branch" });
    const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 4 * 1024 * 1024 } });
    let zipBuffer, message = "Upload project files", tooLarge = false;
    await new Promise((resolve, reject) => {
      bb.on("field", (name, value) => { if (name === "message") message = value.slice(0, 200); });
      bb.on("file", (name, file) => {
        if (name !== "zip") { file.resume(); return; }
        const chunks = [];
        file.on("data", chunk => chunks.push(chunk));
        file.on("limit", () => { tooLarge = true; });
        file.on("end", () => { zipBuffer = Buffer.concat(chunks); });
        file.on("error", reject);
      });
      bb.on("error", reject);
      bb.on("finish", resolve);
      req.pipe(bb);
    });
    if (tooLarge) return res.status(413).json({ error: "ZIP melebihi 4 MB" });
    if (!zipBuffer) return res.status(400).json({ error: "ZIP file tidak ditemukan" });
    const zip = await JSZip.loadAsync(zipBuffer);
    const files = [];
    let totalBytes = 0;
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!clean || clean.startsWith(".git/") || clean.split("/").includes("..")) continue;
      const content = await entry.async("nodebuffer");
      totalBytes += content.length;
      if (totalBytes > 18 * 1024 * 1024) return res.status(413).json({ error: "Ukuran hasil ekstrak melebihi 18 MB" });
      files.push([clean, content]);
    }
    if (!files.length) return res.status(400).json({ error: "ZIP tidak berisi file yang dapat diupload" });
    if (files.length > 400) return res.status(413).json({ error: "Maksimal 400 file per upload" });
    const result = await pushZip({ owner, repo, branch, entries: files, message: message || "Upload project files", overwrite: url.searchParams.get("overwrite") !== "false" });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message, details: error.details });
  }
}
