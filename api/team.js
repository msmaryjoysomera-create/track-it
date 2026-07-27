// Track It — team mailbox + per-person profile sync (Supabase backend)
// Same API as before, so the app needs no changes.
// Storage: two Supabase tables — `rosters` (team counts) and `profiles` (per-person data).
//
// Env vars required (set in Vercel):
//   SUPABASE_URL       e.g. https://xxxx.supabase.co
//   SUPABASE_KEY       the service_role key (server-side only)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);

// --- tiny Supabase REST helpers ---
function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
}
// upsert a row (insert or update on conflict of primary key)
async function sbUpsert(table, row) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=id', {
    method: 'POST',
    headers: Object.assign(sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('sb upsert ' + r.status + ' ' + (await r.text()));
}
// fetch a single row by id; returns the row object or null
async function sbGet(table, id) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id) + '&select=*';
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new Error('sb get ' + r.status);
  const rows = await r.json();
  return (rows && rows[0]) || null;
}
// delete a row by id (idempotent — no error if it doesn't exist)
async function sbDelete(table, id) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: sbHeaders(),
  });
  if (!r.ok) throw new Error('sb delete ' + r.status + ' ' + (await r.text()));
}

const rosterId = team => 'roster:' + slug(team);
const profId = (team, name) => 'prof:' + slug(team) + ':' + slug(name);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'storage not configured' });
  }
  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action || 'counts';
      const team = body.team, name = body.name;
      if (!team || String(team).length < 4 || !name) {
        return res.status(400).json({ error: 'bad request' });
      }

      if (action === 'counts') {
        const days = body.days;
        if (typeof days !== 'object') return res.status(400).json({ error: 'bad request' });
        const clean = {};
        for (const [d, c] of Object.entries(days)) {
          const n = parseInt(c, 10);
          if (/^\d{4}-\d{2}-\d{2}$/.test(d) && n > 0 && n < 10000) clean[d] = n;
        }
        if (!Object.keys(clean).length) return res.status(400).json({ error: 'no counts' });
        const existing = await sbGet('rosters', rosterId(team));
        const reports = (existing && existing.reports) || {};
        reports[String(name).slice(0, 20)] = clean;
        await sbUpsert('rosters', { id: rosterId(team), reports, updated: Date.now() });
        return res.json({ ok: true });
      }

      if (action === 'backup') {
        const blob = body.blob;
        if (typeof blob !== 'string' || blob.length > 2000000) {
          return res.status(400).json({ error: 'bad blob' });
        }
        // preserve existing pinHash if this push doesn't include one
        const existing = await sbGet('profiles', profId(team, name));
        const pinHash = (typeof body.pinHash === 'string' && body.pinHash)
          ? body.pinHash
          : (existing && existing.pinhash) || '';
        await sbUpsert('profiles', { id: profId(team, name), blob, pinhash: pinHash, updated: Date.now() });
        return res.json({ ok: true });
      }

      if (action === 'delete') {
        // removes only this person's own profile record; team roster counts (Jun's
        // payment records) are untouched, since those belong to Jun, not this profile
        await sbDelete('profiles', profId(team, name));
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'unknown action' });
    }

    if (req.method === 'GET') {
      const team = req.query.team;
      if (!team || String(team).length < 4) return res.status(400).json({ error: 'bad request' });
      if (req.query.name) {
        const rec = await sbGet('profiles', profId(team, req.query.name));
        if (req.query.check) {
          let role = '';
          if (rec && rec.blob) { try { const b = JSON.parse(rec.blob); role = (b.data && b.data.role) || ''; } catch (e) {} }
          return res.json({ exists: !!rec, pinHash: rec ? (rec.pinhash || '') : '', role });
        }
        return res.json({
          blob: rec ? rec.blob : null,
          updated: rec ? rec.updated : 0,
          pinHash: rec ? (rec.pinhash || '') : '',
          exists: !!rec,
        });
      }
      const rec = await sbGet('rosters', rosterId(team));
      return res.json(rec ? { reports: rec.reports || {} } : { reports: {} });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'storage unavailable' });
  }
}
