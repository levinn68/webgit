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
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const statusCode = response.status === 401 || response.status === 403 ? 502 : response.status;
    throw Object.assign(new Error(data.message || "GitHub API error"), {
      statusCode,
      details: { githubStatus: response.status, errors: data.errors }
    });
  }
  return data;
}

export async function listRepos({ page = 1, perPage = 100 } = {}) {
  const params = new URLSearchParams({
    per_page: String(Math.min(100, Math.max(1, perPage))),
    page: String(Math.max(1, page)),
    sort: "updated"
  });
  const data = await request("/user/repos?" + params);
  return data.map(repo => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    default_branch: repo.default_branch,
    updated_at: repo.updated_at,
    permissions: repo.permissions,
    owner: repo.owner.login
  }));
}

export async function createRepo({ name, description = "", isPrivate = true }) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === "." || name === "..") {
    throw Object.assign(new Error("Nama repository tidak valid."), { statusCode: 400 });
  }
  return request("/user/repos", {
    method: "POST",
    body: JSON.stringify({ name, description, private: Boolean(isPrivate), auto_init: true })
  });
}

export async function getRepo({ owner, repo }) {
  return request("/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo));
}

export async function pushZip({ owner, repo, branch, entries, message, onProgress = () => {} }) {
  const repoPath = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const metadata = await request(repoPath);
  if (metadata.archived) throw Object.assign(new Error("Repository archived dan tidak bisa menerima upload."), { statusCode: 409 });
  if (metadata.permissions && metadata.permissions.push === false) {
    throw Object.assign(new Error("Akun tidak punya izin push ke repository ini."), { statusCode: 403 });
  }

  const targetBranch = String(branch || metadata.default_branch || "main");
  if (!/^[A-Za-z0-9._/-]+$/.test(targetBranch) || targetBranch.includes("..") || targetBranch.startsWith("/") || targetBranch.endsWith("/")) {
    throw Object.assign(new Error("Nama branch tidak valid."), { statusCode: 400 });
  }

  const refPath = repoPath + "/git/ref/heads/" + encodePath(targetBranch);
  let parentSha;
  try {
    parentSha = (await request(refPath)).object.sha;
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    if (!metadata.default_branch) {
      throw Object.assign(new Error("Repository kosong. Buat repository dengan README atau inisialisasi branch terlebih dahulu."), { statusCode: 409 });
    }
    parentSha = (await request(repoPath + "/git/ref/heads/" + encodePath(metadata.default_branch))).object.sha;
    if (targetBranch !== metadata.default_branch) {
      try {
        await request(repoPath + "/git/refs", {
          method: "POST",
          body: JSON.stringify({ ref: "refs/heads/" + targetBranch, sha: parentSha })
        });
      } catch (createError) {
        if (createError.statusCode !== 422) throw createError;
        parentSha = (await request(refPath)).object.sha;
      }
    }
  }

  const parentCommit = await request(repoPath + "/git/commits/" + parentSha);
  const treeEntries = [];
  let completed = 0;
  const total = entries.length;
  const concurrency = 4;

  onProgress({ progress: 32, label: "CREATING GIT BLOBS", message: "Repository verified. Preparing " + total + " file blobs." });

  for (let offset = 0; offset < entries.length; offset += concurrency) {
    const batch = entries.slice(offset, offset + concurrency);
    const created = await Promise.all(batch.map(async ([path, bytes]) => {
      const blob = await request(repoPath + "/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: bytes.toString("base64"), encoding: "base64" })
      });
      completed += 1;
      const percent = 34 + Math.round((completed / total) * 48);
      onProgress({
        progress: percent,
        label: "UPLOADING FILE BLOBS",
        message: "Stored " + completed + "/" + total + ": " + path,
        level: "SUCCESS"
      });
      return { path, mode: "100644", type: "blob", sha: blob.sha };
    }));
    treeEntries.push(...created);
  }

  onProgress({ progress: 84, label: "BUILDING COMMIT", message: "All file blobs stored. Building repository tree." });
  const newTree = await request(repoPath + "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: treeEntries })
  });

  onProgress({ progress: 91, label: "CREATING COMMIT", message: "Creating a single Git commit." });
  const commit = await request(repoPath + "/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: message || "Upload project files",
      tree: newTree.sha,
      parents: [parentSha]
    })
  });

  onProgress({ progress: 96, label: "UPDATING BRANCH", message: "Updating " + targetBranch + " without force push." });
  await request(repoPath + "/git/refs/heads/" + encodePath(targetBranch), {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });

  return {
    owner,
    repo,
    branch: targetBranch,
    files: entries.length,
    commit: commit.sha,
    commitUrl: "https://github.com/" + owner + "/" + repo + "/commit/" + commit.sha,
    url: "https://github.com/" + owner + "/" + repo + "/tree/" + encodeURIComponent(targetBranch)
  };
}