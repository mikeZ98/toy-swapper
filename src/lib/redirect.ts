/**
 * Open-redirect guard (S-01).
 *
 * Single source of truth for "is this redirect target safe to honor". Any
 * caller-supplied `redirect` value (middleware building the sign-in bounce, the
 * sign-in handler consuming it) must flow through this function before it lands
 * in a `Location` header — otherwise `//evil.com` or `https://evil.com` would
 * turn our sign-in flow into an open redirect.
 *
 * The accepted shape is a *same-site absolute path*: exactly one leading slash,
 * no protocol, no backslashes, no control characters, no whitespace. Anything
 * else collapses to `fallback` (default `/`). Pure function, no I/O.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;

  // Must be an absolute local path: a single leading slash, never `//` (a
  // protocol-relative URL like `//evil.com`) nor `/\` (browsers normalize the
  // backslash to a slash, so `/\evil` becomes `//evil`).
  if (!raw.startsWith("/")) return fallback;
  if (raw[1] === "/" || raw[1] === "\\") return fallback;

  // Reject scheme markers and backslashes anywhere in the value.
  if (raw.includes("://")) return fallback;
  if (raw.includes("\\")) return fallback;

  // Reject any whitespace and any C0/DEL control character. Char-code checks
  // avoid a control-character regex literal (which lint flags as suspicious).
  if (/\s/.test(raw)) return fallback;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return fallback;
  }

  return raw;
}
