import { head, put } from "@vercel/blob";

/**
 * Short demo links. POST /api/share { token } stores a packed demo (see share.ts) and returns { id };
 * GET /api/share?id= returns { token }. Needs BLOB_READ_WRITE_TOKEN (a public Vercel Blob store).
 */
const MAX_TOKEN = 60_000;
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": status === 200 ? "public, max-age=300" : "no-store" } });

export async function handleShare(request: Request): Promise<Response> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: "short links are not configured" }, 501);
  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]+$/.test(body.token) || body.token.length > MAX_TOKEN) return json({ error: "bad demo" }, 400);
    const id = newId();
    await put(`d/${id}.txt`, body.token, { access: "public", addRandomSuffix: false, contentType: "text/plain" });
    return json({ id });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9]{6,16}$/.test(id)) return json({ error: "bad id" }, 400);
  try {
    const blob = await head(`d/${id}.txt`);
    const token = await (await fetch(blob.url)).text();
    return json({ token });
  } catch {
    return json({ error: "not found" }, 404);
  }
}
