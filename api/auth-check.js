import { assertDeployKey } from "./_lib/auth.js";
export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    assertDeployKey(req);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message });
  }
}