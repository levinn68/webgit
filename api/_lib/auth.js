import crypto from "node:crypto";

export function assertDeployKey(req) {
  const expected = process.env.DEPLOY_KEY || "";
  const got = req.headers["x-deploy-key"] || "";

  if (!expected) {
    const e = new Error("Server misconfigured: DEPLOY_KEY not set");
    e.statusCode = 500;
    throw e;
  }

  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(got));

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const e = new Error("Unauthorized (bad deploy key)");
    e.statusCode = 401;
    throw e;
  }
}
