// Diagnostic: tests a Blob WRITE and returns the real error.
// Visit /api/selftest in a browser. Delete this file once sync works.
import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { hasToken: !!process.env.BLOB_READ_WRITE_TOKEN };
  try {
    const r = await put('teams/_selftest.json', JSON.stringify({ t: Date.now() }), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
    out.write = 'ok';
    out.url = r.url;
  } catch (e) {
    out.write = 'FAILED';
    out.error = String(e && e.message || e);
  }
  try {
    const { blobs } = await list({ prefix: 'teams/' });
    out.read = 'ok';
    out.files = blobs.map(b => b.pathname);
  } catch (e) {
    out.read = 'FAILED';
    out.readError = String(e && e.message || e);
  }
  return res.json(out);
}
