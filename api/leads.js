// Vercel serverless function: /api/leads
//
//   GET  /api/leads?status=new   -> list pending leads (JSON array)
//   POST /api/leads              -> ingest a new lead (from Trigify HTTP node)
//                                   or update a lead's status:
//                                   { "action":"update", "id":"...", "status":"messaged" }
//
// Optional: protect ingestion with a shared secret. Set INGEST_SECRET in Vercel
// env, then have Trigify send header  x-gm-secret: <that value>.

import { addLead, listLeads, updateLead } from "./_store.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-gm-secret");
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  // stream fallback
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    if (req.method === "GET") {
      const status = (req.query && req.query.status) || "new";
      const leads = await listLeads(status);
      res.status(200).json(leads);
      return;
    }

    if (req.method === "POST") {
      const body = await readBody(req);

      // 1) status update from the review UI
      if (body && body.action === "update") {
        if (!body.id || !body.status) {
          res.status(400).json({ ok: false, error: "id and status required" });
          return;
        }
        const out = await updateLead(body.id, body.status);
        res.status(out.ok ? 200 : 404).json(out);
        return;
      }

      // 2) new lead ingestion (Trigify) — optional shared-secret check
      const need = process.env.INGEST_SECRET;
      if (need && req.headers["x-gm-secret"] !== need) {
        res.status(401).json({ ok: false, error: "unauthorized" });
        return;
      }
      const out = await addLead(body || {});
      res.status(200).json(out);
      return;
    }

    res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (err) {
    res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
}
