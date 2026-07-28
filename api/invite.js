// Track It — invite a teammate by email (Supabase Auth admin action)
// Only a logged-in lead may call this. Uses the service_role key, so it
// must stay server-side — never call the admin invite/users endpoints
// from the browser.

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
async function sbUpsert(table, row) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=id', {
    method: 'POST',
    headers: Object.assign(sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('sb upsert ' + r.status + ' ' + (await r.text()));
}
async function sbInsert(table, row) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: Object.assign(sbHeaders(), { 'Prefer': 'return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('sb insert ' + r.status + ' ' + (await r.text()));
}
// verify the caller's access token and return their auth user id, or null
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
async function findAuthUserByEmail(email) {
  const url = SUPABASE_URL + '/auth/v1/admin/users?email=' + encodeURIComponent(email);
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) return null;
  const j = await r.json();
  const users = (j && j.users) || [];
  return users.find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
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
    if (!caller || caller.role !== 'lead') {
      return res.status(403).json({ error: 'only a team lead can send invites' });
    }

    const email = String((req.body || {}).email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'enter a valid email' });
    }

    const existingAuthUser = await findAuthUserByEmail(email);
    if (existingAuthUser) {
      const existingProfile = await sbGet('profiles', existingAuthUser.id);
      if (existingProfile && existingProfile.lead_id === callerId) {
        return res.json({ ok: true, alreadyInvited: true });
      }
      if (existingProfile && (existingProfile.role === 'lead' || existingProfile.lead_id)) {
        return res.status(409).json({ error: 'that email already belongs to another team' });
      }
      // exists in auth but has no profile row (orphaned) — safe to attach
      await sbUpsert('profiles', {
        id: existingAuthUser.id, role: 'member', email, name: null,
        lead_id: callerId, blob: null, updated: Date.now(),
      });
      await sbInsert('invites', { email, lead_id: callerId, created_at: Date.now(), accepted: true });
      return res.json({ ok: true });
    }

    const inviteRes = await fetch(SUPABASE_URL + '/auth/v1/invite', {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify({ email }),
    });
    if (!inviteRes.ok) {
      const detail = await inviteRes.text();
      return res.status(502).json({ error: 'could not send invite', detail });
    }
    const invited = await inviteRes.json();
    if (!invited || !invited.id) {
      return res.status(502).json({ error: 'invite succeeded but no user id returned' });
    }

    // attach lead_id now — the invitee's profile is correct from the moment
    // the invite is sent, no need to wait for them to click the email link
    await sbUpsert('profiles', {
      id: invited.id, role: 'member', email, name: null,
      lead_id: callerId, blob: null, updated: Date.now(),
    });
    await sbInsert('invites', { email, lead_id: callerId, created_at: Date.now(), accepted: false });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'invite failed' });
  }
}
