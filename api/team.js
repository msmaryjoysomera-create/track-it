// Track It — team mailbox + per-person profile sync
// Actions (POST body.action):
//   'counts'  : a member pushes daily counts  { team, name, days }        (team roster)
//   'backup'  : any profile pushes its full state { team, name, blob }     (cross-device)
// GET:
//   ?team=CODE                : returns { reports } roster of member counts
//   ?team=CODE&name=NAME       : returns { blob } that person's saved state (or null)
import { put, list } from '@vercel/blob';

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
const rosterKey = team => 'teams/' + slug(team) + '.json';
const profKey = (team, name) => 'profiles/' + slug(team) + '/' + slug(name) + '.json';

async function readJSON(key) {
  const { blobs } = await list({ prefix: key });
  const hit = blobs.find(b => b.pathname === key) || blobs[0];
  if (!hit) return null;
  try {
    const r = await fetch(hit.url + '?t=' + Date.now());
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function writeJSON(key, obj) {
  await put(key, JSON.stringify(obj), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
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
        const data = (await readJSON(rosterKey(team))) || { reports: {} };
        data.reports = data.reports || {};
        data.reports[String(name).slice(0, 20)] = clean;
        data.updated = Date.now();
        await writeJSON(rosterKey(team), data);
        return res.json({ ok: true });
      }

      if (action === 'backup') {
        const blob = body.blob;
        if (typeof blob !== 'string' || blob.length > 2000000) {
          return res.status(400).json({ error: 'bad blob' });
        }
        await writeJSON(profKey(team, name), { blob, updated: Date.now() });
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'unknown action' });
    }

    if (req.method === 'GET') {
      const team = req.query.team;
      if (!team || String(team).length < 4) return res.status(400).json({ error: 'bad request' });
      if (req.query.name) {
        const rec = await readJSON(profKey(team, req.query.name));
        return res.json({ blob: rec ? rec.blob : null, updated: rec ? rec.updated : 0 });
      }
      const data = (await readJSON(rosterKey(team))) || { reports: {} };
      return res.json(data);
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'storage unavailable' });
  }
}
