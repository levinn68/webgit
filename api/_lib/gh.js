const API = "https://api.github.com";

function env(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error(name + " is not configured"), { statusCode: 500 });
  return value;
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
  const data = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw Object.assign(new Error(data.message || "GitHub API error"), { statusCode: response.status, details: data });
  return data;
}

export async function pushZip({ owner, repo, branch, entries, message, overwrite }) {
  const repoPath = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  const meta = await request(repoPath);
  const refPath = repoPath + "/git/ref/heads/" + branch.split("/").map(encodeURIComponent).join("/");
  let parentSha;
  try {
    parentSha = (await request(refPath)).object.sha;
  } catch (error) {
    if (error.statusCode !== 404) throw error;
    const defaultSha = (await request(repoPath + "/git/ref/heads/" + encodeURIComponent(meta.default_branch))).object.sha;
    await request(repoPath + "/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/" + branch, sha: defaultSha }) });
    parentSha = defaultSha;
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
    body: JSON.stringify({ base_tree: overwrite ? parent.tree.sha : undefined, tree })
  });
  const commit = await request(repoPath + "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] })
  });
  await request(repoPath + "/git/refs/heads/" + branch.split("/").map(encodeURIComponent).join("/"), {
    method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return { owner, repo, branch, files: entries.length, commit: commit.sha };
}
