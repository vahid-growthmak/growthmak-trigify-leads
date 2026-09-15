// Storage layer for Growthmak lead review.
// Uses Vercel KV (Upstash Redis) when its env vars are present,
// otherwise falls back to an in-memory store (fine for local `vercel dev`).
//
// NOTE: the in-memory store resets whenever the serverless function cold-starts,
// so for real production you want KV connected (see the deploy guide).

const KEY = "gm:leads"; // KV list (JSON strings, newest first)

let kvPromise = null;
function getKV() {
  const hasKV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
  if (!hasKV) return null;
  if (!kvPromise) {
    kvPromise = import("@vercel/kv")
      .then((m) => m.kv)
      .catch(() => null);
  }
  return kvPromise;
}

// ---- in-memory fallback ----
function mem() {
  if (!globalThis.__gm_leads) globalThis.__gm_leads = [];
  return globalThis.__gm_leads;
}

function makeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function normalize(p = {}) {
  return {
    id: p.id || makeId(),
    source: p.source || "",
    authorUrl: p.authorUrl || "",
    authorName: p.authorName || "",
    authorTitle: p.authorTitle || "",
    authorAvatar: p.authorAvatar || "",
    text: p.text || "",
    postUrl: p.postUrl || p.authorUrl || "",
    likes: Number(p.likes) || 0,
    comments: Number(p.comments) || 0,
    datePosted: p.datePosted || "",
    status: "new",
    createdAt: new Date().toISOString(),
  };
}

// ---- public API ----

export async function addLead(payload) {
  const lead = normalize(payload);
  const kv = await getKV();

  if (kv) {
    // dedupe by postUrl
    if (lead.postUrl) {
      const existing = await listLeads(); // small volume; fine to scan
      if (existing.some((l) => l.postUrl && l.postUrl === lead.postUrl)) {
        return { ok: true, deduped: true, lead: null };
      }
    }
    await kv.lpush(KEY, JSON.stringify(lead));
    return { ok: true, lead };
  }

  const store = mem();
  if (lead.postUrl && store.some((l) => l.postUrl === lead.postUrl)) {
    return { ok: true, deduped: true, lead: null };
  }
  store.unshift(lead);
  return { ok: true, lead };
}

export async function listLeads(status) {
  const kv = await getKV();
  let all;
  if (kv) {
    const raw = await kv.lrange(KEY, 0, -1);
    all = (raw || []).map((r) => (typeof r === "string" ? safeParse(r) : r)).filter(Boolean);
  } else {
    all = mem().slice();
  }
  if (status) all = all.filter((l) => l.status === status);
  return all;
}

export async function updateLead(id, status) {
  const kv = await getKV();
  if (kv) {
    const raw = await kv.lrange(KEY, 0, -1);
    const arr = (raw || []).map((r) => (typeof r === "string" ? safeParse(r) : r)).filter(Boolean);
    const idx = arr.findIndex((l) => l.id === id);
    if (idx === -1) return { ok: false, notFound: true };
    arr[idx] = { ...arr[idx], status, actionedAt: new Date().toISOString() };
    // rewrite the list
    await kv.del(KEY);
    if (arr.length) {
      // lpush reverses order, so push in reverse to preserve newest-first
      await kv.rpush(KEY, ...arr.map((l) => JSON.stringify(l)));
    }
    return { ok: true, lead: arr[idx] };
  }

  const store = mem();
  const item = store.find((l) => l.id === id);
  if (!item) return { ok: false, notFound: true };
  item.status = status;
  item.actionedAt = new Date().toISOString();
  return { ok: true, lead: item };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
