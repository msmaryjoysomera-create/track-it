// Track It — a team member submits their daily counts to their lead's roster.
// Requires a valid session; the lead to write to is looked up server-side
// from the caller's own profile row — never trusted from the request body.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
}
async function sbGet(table, id) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id) + '&select=*';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error('sb get ' + r.status);
  const rows = await r.json();
  return (rows && rows[0]) || null;
}
async function sbGetByLead(table, leadId) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?lead_id=eq.' + encodeURIComponent(leadId) + '&select=*';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error('sb get ' + r.status);
  const rows = await r.json();
  return (rows && rows[0]) || null;
}
async function sbUpsertRoster(row) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/rosters?on_conflict=lead_id', {
    method: 'POST',
    headers: Object.assign(sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('sb upsert ' + r.status + ' ' + (await r.text()));
}
async function verifyCaller(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return (u && u.id) ? u.id : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'storage not configured' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  try {
    const callerId = await verifyCaller(req);
    if (!callerId) return res.status(401).json({ error: 'not logged in' });

    const caller = await sbGet('profiles', callerId);
    if (!caller || !caller.lead_id) {
      return res.status(400).json({ error: 'no lead to send counts to' });
    }

    const days = (req.body || {}).days;
    if (typeof days !== 'object' || !days) return res.status(400).json({ error: 'bad request' });
    const clean = {};
    for (const [d, c] of Object.entries(days)) {
      const n = parseInt(c, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && n > 0 && n < 10000) clean[d] = n;
    }
    if (!Object.keys(clean).length) return res.status(400).json({ error: 'no counts' });

    const existing = await sbGetByLead('rosters', caller.lead_id);
    const reports = (existing && existing.reports) || {};
    const memberName = (caller.name || caller.email || 'Member').slice(0, 20);
    reports[memberName] = clean;
    await sbUpsertRoster({ lead_id: caller.lead_id, reports, updated: Date.now() });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'submit failed' });
  }
}
