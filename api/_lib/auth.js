import crypto from "node:crypto";

export function assertDeployKey(req) {
  // Optional extra gate. GitHub credentials remain server-side regardless.
  const expected = process.env.DEPLOY_KEY || "";
  if (!expected) return;
  const got = req.headers["x-deploy-key"] || "";
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(got));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const e = new Error("Unauthorized");
    e.statusCode = 401;
    throw e;
  }
}
