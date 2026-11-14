import Busboy from "busboy";
import JSZip from "jszip";
import { assertDeployKey } from "./_lib/auth.js";
import { pushZip } from "./_lib/gh.js";

export const config = { api: { bodyParser: false } };

function send(res, payload) {
  res.write(JSON.stringify({ ...payload, time: new Date().toLocaleTimeString("id-ID", { hour12: false }) }) + "\n");
}

export default async function handler(req, res) {
  let streaming = false;
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    assertDeployKey(req);
    const url = new URL(req.url, "https://" + (req.headers.host || "localhost"));
    const target = url.searchParams.get("repo") || "";
    const branch = url.searchParams.get("branch") || "main";
    const parts = target.split("/");
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part))) {
      return res.status(400).json({ error: "Pilih repository dengan format owner/name." });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    streaming = true;

    send(res, { type: "log", level: "INFO", message: "Request accepted. Checking archive…" });
    send(res, { type: "progress", progress: 8, label: "RECEIVING ARCHIVE" });

    let archive;
    let message = "Upload project files";
    let tooLarge = false;
    await new Promise((resolve, reject) => {
      const parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 4 * 1024 * 1024 } });
      parser.on("field", (name, value) => {
        if (name === "message") message = String(value).slice(0, 200);
      });
      parser.on("file", (name, stream) => {
        if (name !== "zip") { stream.resume(); return; }
        const chunks = [];
        stream.on("data", chunk => chunks.push(chunk));
        stream.on("limit", () => { tooLarge = true; });
        stream.on("end", () => { archive = Buffer.concat(chunks); });
        stream.on("error", reject);
      });
      parser.on("error", reject);
      parser.on("finish", resolve);
      req.pipe(parser);
    });

    if (tooLarge) throw Object.assign(new Error("ZIP melebihi batas 4 MB."), { statusCode: 413 });
    if (!archive || !archive.length) throw Object.assign(new Error("File ZIP tidak ditemukan."), { statusCode: 400 });

    send(res, { type: "log", level: "SUCCESS", message: "Archive received (" + archive.length + " bytes)." });
    send(res, { type: "progress", progress: 18, label: "EXTRACTING ZIP" });

    const zip = await JSZip.loadAsync(archive);
    const entries = [];
    const seen = new Set();
    let expanded = 0;

    for (const [rawPath, item] of Object.entries(zip.files)) {
      if (item.dir) continue;
      const path = rawPath.replace(/\\/g, "/");
      if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..") || path.includes("\0")) {
        throw Object.assign(new Error("ZIP contains an unsafe path: " + rawPath.slice(0, 140)), { statusCode: 400 });
      }
      if (path.startsWith(".git/")) continue;
      const unixMode = typeof item.unixPermissions === "number" ? item.unixPermissions & 0o170000 : 0;
      if (unixMode === 0o120000) throw Object.assign(new Error("ZIP symlink entries are not supported: " + path), { statusCode: 400 });
      if (seen.has(path)) throw Object.assign(new Error("Duplicate path detected: " + path), { statusCode: 400 });
      seen.add(path);
      const bytes = await item.async("nodebuffer");
      expanded += bytes.length;
      if (expanded > 18 * 1024 * 1024) throw Object.assign(new Error("Expanded ZIP exceeds 18 MB."), { statusCode: 413 });
      entries.push([path, bytes]);
    }

    if (!entries.length) throw Object.assign(new Error("ZIP kosong atau tidak memiliki file yang dapat diunggah."), { statusCode: 400 });
    if (entries.length > 400) throw Object.assign(new Error("Maksimal 400 file per upload."), { statusCode: 413 });

    send(res, { type: "log", level: "SUCCESS", message: entries.length + " file extracted. Preparing GitHub commit…" });
    send(res, { type: "progress", progress: 28, label: "PREPARING FILE TREE" });

    const [owner, repo] = parts;
    const result = await pushZip({
      owner, repo, branch, entries, message,
      onProgress: event => {
        if (event.message) send(res, { type: "log", level: event.level || "INFO", message: event.message });
        if (typeof event.progress === "number") send(res, { type: "progress", progress: event.progress, label: event.label || "UPLOADING FILES" });
      }
    });

    send(res, { type: "progress", progress: 100, label: "COMMIT COMPLETED" });
    send(res, { type: "log", level: "SUCCESS", message: "Commit created: " + result.commit });
    send(res, { type: "done", result });
    return res.end();
  } catch (error) {
    if (streaming) {
      try {
        send(res, { type: "error", level: "ERROR", message: error.message || "Upload failed." });
        return res.end();
      } catch { return; }
    }
    return res.status(error.statusCode || 500).json({ error: error.message || "Upload failed." });
  }
}