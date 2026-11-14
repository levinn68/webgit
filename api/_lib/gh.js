const API = "https://api.github.com";

function env(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(name + " is not configured in Vercel"), { statusCode: 503 });
  return value;
}

function encodePath(value) {
  return String(value).split("/").map(encodeURIComponent).join("/");
}

async function request(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + env("GITHUB_TOKEN"),
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { message: raw || "Invalid GitHub response" }; }
  if (!response.ok) {
    const message = data.message || "GitHub API error";
    const statusCode = response.status === 401 || response.status === 403 ? 502 : response.status;
    throw Object.assign(new Error(message), { statusCode, details: { githubStatus: response.status, errors: data.errors } });
  }
  return data;
}

export async function listRepos({ page = 1, perPage = 100, query = "" } = {}) {
  const owner = env("GITHUB_OWNER");
  const params = new URLSearchParams({ per_page: String(Math.min(Math.max(perPage, 1), 100)), page: String(Math.max(1, page)), sort: "updated" });
  const data = await request("/user/repos?" + params.toString());
  const filtered = query ? data.filter(r => r.full_name.toLowerCase().includes(query.toLowerCase())) : data;
  return filtered.map(r => ({
    id: r.id, name: r.name, full_name: r.full_name, description: r.description,
    private: r.private, default_branch: r.default_branch, updated_at: r.updated_at,
    permissions: r.permissions, owner: r.owner.login
  }));
}

export async function createRepo({ name, description = "", isPrivate = true, autoInit = true }) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === "." || name === "..") {
    throw Object.assign(new Error("Nama repository tidak valid."), { statusCode: 400 });
  }
  return request("/user/repos", {
    method: "POST",
    body: JSON.stringify({ name, description, private: !!isPrivate, auto_init: !!autoInit })
  });
}

export async function getRepo({ owner, repo }) {
  return request("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo));
}

export async function ensureRepo({ owner, repo, makePrivate = true, autoInit = true }) {
  try { return await getRepo({ owner, repo }); }
  catch (error) {
    if (error.statusCode !== 404) throw error;
    return createRepo({ name: repo, isPrivate: makePrivate, autoInit });
  }
}

export async function pushZip({ owner, repo, branch, entries, message, overwrite = true }) {
  const repoPath = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const meta = await request(repoPath);
  if (meta.archived) throw Object.assign(new Error("Repository ini archived dan tidak bisa menerima upload."), { statusCode: 409 });
  if (meta.permissions && meta.permissions.push === false) throw Object.assign(new Error("Akun GitHub tidak punya izin push ke repository ini."), { statusCode: 403 });

  const safeBranch = String(branch || meta.default_branch || "main");
  if (!/^[A-Za-z0-9._/-]+$/.test(safeBranch) || safeBranch.includes("..") || safeBranch.startsWith("/") || safeBranch.endsWith("/")) {
    throw Object.assign(new Error("Nama branch tidak valid."), { statusCode: 400 });
  }

  const refPath = repoPath + "/git/ref/heads/" + encodePath(safeBranch);
  let parentSha = null;
  try { parentSha = (await request(refPath)).object.sha; }
  catch (error) {
    if (error.statusCode !== 404) throw error;
    if (!meta.default_branch) throw Object.assign(new Error("Repository kosong. Pilih branch main atau buat repository dengan auto-init."), { statusCode: 409 });
    parentSha = (await request(repoPath + "/git/ref/heads/" + encodePath(meta.default_branch))).object.sha;
    if (safeBranch !== meta.default_branch) {
      try {
        await request(repoPath + "/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/" + safeBranch, sha: parentSha }) });
      } catch (createError) {
        if (createError.statusCode !== 422) throw createError;
        parentSha = (await request(refPath)).object.sha;
      }
    }
  }

  const parent = await request(repoPath + "/git/commits/" + parentSha);
  const tree = [];
  for (const [path, bytes] of entries) {
    const blob = await request(repoPath + "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: bytes.toString("base64"), encoding: "base64" })
    });
    tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const newTree = await request(repoPath + "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: overwrite ? parent.tree.sha : parent.tree.sha, tree })
  });
  const commit = await request(repoPath + "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: message || "Upload project files", tree: newTree.sha, parents: [parentSha] })
  });

  await request(repoPath + "/git/refs/heads/" + encodePath(safeBranch), {
    method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { owner, repo, branch: safeBranch, files: entries.length, commit: commit.sha, url: "https://github.com/" + owner + "/" + repo + "/tree/" + encodeURIComponent(safeBranch) };
}
