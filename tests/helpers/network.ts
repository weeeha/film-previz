// The local-only check (spec criterion 11): what a request log must satisfy.

export type Req = { url: string; method: string; body: Uint8Array | null };

export const MAX_BODY_BYTES = 10 * 1024;

/** blob: and data: URLs are read inside the page and never reach the network; about: is the blank page. */
export const isLocalScheme = (url: string): boolean => /^(blob|data|about):/i.test(url);

const contains = (hay: Uint8Array, needle: Uint8Array): boolean => Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).includes(Buffer.from(needle));

/**
 * Violations of the three rules, one line each. `origin` is the app's host (with port), `head` the first 64 bytes of the scene file.
 * Local-scheme URLs are skipped, as the test says in its report. http, https, ws and wss URLs must carry the origin's host.
 */
export function networkViolations(reqs: Req[], origin: string, head: Uint8Array): string[] {
  const out: string[] = [];
  for (const r of reqs) {
    if (isLocalScheme(r.url)) continue;
    let host = "";
    try { host = new URL(r.url).host; } catch { out.push(`unreadable URL: ${r.url}`); continue; }
    if (host !== origin) out.push(`other host: ${r.method} ${r.url}`);
    if (r.body && r.body.byteLength > MAX_BODY_BYTES) out.push(`body over ${MAX_BODY_BYTES} bytes (${r.body.byteLength}): ${r.method} ${r.url}`);
    if (r.body && contains(r.body, head)) out.push(`scene bytes in the body: ${r.method} ${r.url}`);
  }
  return out;
}
