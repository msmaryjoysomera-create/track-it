// Track It — a self-registered team member links to "the" lead.
// There's exactly one lead in this app (Jun). Rather than exposing a broad
// "anyone can read the lead's row" RLS policy (which would let a new
// member's client query Jun's private blob/email directly), the lookup
// happens here server-side with the service_role key, and only the
// caller's OWN profile row gets written — never a client-supplied id.

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
async function findLeads() {
  const url = SUPABASE_URL + '/rest/v1/profiles?role=eq.lead&select=id';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error('sb get ' + r.status);
  return await r.json();
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
    if (!caller) return res.status(404).json({ error: 'profile not found' });
    if (caller.role === 'lead') return res.json({ ok: true, alreadyLead: true });
    if (caller.lead_id) return res.json({ ok: true, alreadyLinked: true });

    const leads = await findLeads();
    if (!leads.length) {
      return res.status(404).json({ error: 'No team lead has signed up yet — ask them to sign up first.' });
    }
    if (leads.length > 1) {
      return res.status(409).json({ error: 'More than one team lead exists — contact support.' });
    }

    const r = await fetch(SUPABASE_URL + '/rest/v1/profiles?id=eq.' + encodeURIComponent(callerId), {
      method: 'PATCH',
      headers: Object.assign(sbHeaders(), { Prefer: 'return=minimal' }),
      body: JSON.stringify({ lead_id: leads[0].id }),
    });
    if (!r.ok) throw new Error('sb patch ' + r.status + ' ' + (await r.text()));

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'join failed' });
  }
}
