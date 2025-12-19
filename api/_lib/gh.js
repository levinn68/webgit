const API = "https://api.github.com";

function mustEnv() {
  if (!process.env.GITHUB_TOKEN) throw Object.assign(new Error("GITHUB_TOKEN not set"), { statusCode: 500 });
  if (!process.env.GITHUB_OWNER) throw Object.assign(new Error("GITHUB_OWNER not set"), { statusCode: 500 });
}

async function gh(path, { method = "GET", body } = {}) {
  mustEnv();

  const res = await fetch(API + path, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
  if (!res.ok) {
    const e = new Error(json?.message || res.statusText || "GitHub API error");
    e.statusCode = res.status;
    e.details = json;
    throw e;
  }
  return json;
}

const OWNER = () => process.env.GITHUB_OWNER;
const OWNER_TYPE = () => process.env.GITHUB_OWNER_TYPE || "user";

export async function ensureRepo({ repo, makePrivate }) {
  let existing = null;

  try {
    existing = await gh(`/repos/${OWNER()}/${repo}`);
  } catch (e) {
    if (e.statusCode !== 404) throw e;
  }

  if (!existing) {
    const payload = { name: repo, private: !!makePrivate, auto_init: true };

    if (OWNER_TYPE() === "org") {
      await gh(`/orgs/${OWNER()}/repos`, { method: "POST", body: payload });
    } else {
      await gh(`/user/repos`, { method: "POST", body: payload });
    }
    return;
  }

  // ✅ sync visibility if needed (token harus punya admin permission)
  if (typeof makePrivate === "boolean" && existing.private !== !!makePrivate) {
    await gh(`/repos/${OWNER()}/${repo}`, {
      method: "PATCH",
      body: { private: !!makePrivate }
    });
  }
}

export async function getDefaultBranch(repo) {
  const r = await gh(`/repos/${OWNER()}/${repo}`);
  return r.default_branch;
}

export async function getRefSha(repo, branch) {
  const ref = await gh(`/repos/${OWNER()}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

export async function createBranch(repo, branch, fromSha) {
  await gh(`/repos/${OWNER()}/${repo}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${branch}`, sha: fromSha }
  });
}

export async function getCommit(repo, sha) {
  return gh(`/repos/${OWNER()}/${repo}/git/commits/${sha}`);
}

export async function createBlob(repo, base64Content) {
  return gh(`/repos/${OWNER()}/${repo}/git/blobs`, {
    method: "POST",
    body: { content: base64Content, encoding: "base64" }
  });
}

export async function createTree(repo, baseTreeSha, entries) {
  return gh(`/repos/${OWNER()}/${repo}/git/trees`, {
    method: "POST",
    body: { base_tree: baseTreeSha, tree: entries }
  });
}

export async function createCommitObj(repo, message, treeSha, parentSha) {
  return gh(`/repos/${OWNER()}/${repo}/git/commits`, {
    method: "POST",
    body: { message, tree: treeSha, parents: [parentSha] }
  });
}

export async function updateRef(repo, branch, sha) {
  return gh(`/repos/${OWNER()}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: { sha, force: true }
  });
}
