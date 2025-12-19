import { assertDeployKey } from "./_lib/auth.js";
import { ensureRepo } from "./_lib/gh.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    assertDeployKey(req);

    const { repo, branch = "main", makePrivate = true } = req.body || {};
    if (!repo || typeof repo !== "string") return res.status(400).json({ error: "repo required" });

    await ensureRepo({ repo, makePrivate });

    return res.status(200).json({
      ok: true,
      owner: process.env.GITHUB_OWNER,
      repo,
      branch,
      makePrivate: !!makePrivate
    });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message, details: e.details });
  }
}
