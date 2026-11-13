import crypto from "node:crypto";

export function assertDeployKey(req) {
  // DEPLOY_KEY is the user-chosen WebGit password stored only in Vercel env.
  const expected = String(process.env.DEPLOY_KEY || "").trim();
  if (!expected) {
    const e = new Error("DEPLOY_KEY belum dikonfigurasi di Vercel Production");
    e.statusCode = 503;
    throw e;
  }

  const raw = req.headers["x-deploy-key"];
  const got = String(Array.isArray(raw) ? raw[0] || "" : raw || "").trim();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");

  if (!got || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const e = new Error("Password WebGit salah. Periksa kolom Deploy key dan DEPLOY_KEY di Vercel.");
    e.statusCode = 401;
    throw e;
  }
}
