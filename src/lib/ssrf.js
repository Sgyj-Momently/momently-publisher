// SSRF defense for imageUrls.
// Blocks: non-https schemes, loopback, IMDS (169.254.169.254),
// IPv4 private ranges (10/8, 172.16/12, 192.168/16), IPv6 loopback / ULA,
// .local mDNS names.

function isIPv4(host) {
  // Matches dotted-quad with 0..255 octets.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map((s) => Number(s));
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return parts;
}

function isPrivateIPv4(parts) {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local incl. IMDS
  return false;
}

function isBlockedIPv6(host) {
  // host may come bracketed from URL.hostname? In WHATWG URL, hostname for
  // IPv6 omits brackets. Compare case-insensitively.
  const h = host.toLowerCase();
  if (h === "::1") return true;
  if (h === "::") return true;
  // fc00::/7 — first byte hex begins with fc or fd.
  if (/^fc[0-9a-f]{2}:/.test(h) || /^fd[0-9a-f]{2}:/.test(h)) return true;
  // link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

// IPv4-mapped IPv6 (::ffff:a.b.c.d 또는 정규화된 hex 형태 ::ffff:HHHH:HHHH).
// WHATWG URL 은 [::ffff:127.0.0.1] 를 ::ffff:7f00:1 로 정규화한다 → 두 형태 모두 잡는다.
function ipv4Mapped(host) {
  if (!host.startsWith("::ffff:")) return null;
  const tail = host.slice(7);
  const v4 = isIPv4(tail);
  if (v4) return v4;
  const m = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!m) return null;
  const high = parseInt(m[1], 16);
  const low = parseInt(m[2], 16);
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}

export function isImageUrlAllowed(url) {
  if (typeof url !== "string" || url.length === 0) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const rawHost = parsed.hostname;
  if (!rawHost) return false;
  let hostLower = rawHost.toLowerCase();
  // WHATWG URL preserves brackets around IPv6 literals.
  if (hostLower.startsWith("[") && hostLower.endsWith("]")) {
    hostLower = hostLower.slice(1, -1);
  }
  // Trailing-dot FQDN(예: "foo.local.") 정규화 — endsWith(".local") 매칭이 빠지지 않도록.
  if (hostLower.endsWith(".") && hostLower.length > 1) {
    hostLower = hostLower.slice(0, -1);
  }

  if (hostLower === "localhost") return false;
  if (hostLower.endsWith(".local")) return false;

  const v4 = isIPv4(hostLower);
  if (v4) {
    if (isPrivateIPv4(v4)) return false;
    return true;
  }

  // Heuristic: anything containing ':' is treated as IPv6.
  if (hostLower.includes(":")) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d / ::ffff:HHHH:HHHH) 는 내장 IPv4 가 사설망이면 거부.
    const mapped = ipv4Mapped(hostLower);
    if (mapped) {
      if (isPrivateIPv4(mapped)) return false;
      return true;
    }
    if (isBlockedIPv6(hostLower)) return false;
    return true;
  }

  return true;
}

export function filterImageUrls(urls) {
  if (!Array.isArray(urls)) return { ok: false, badUrl: null };
  for (const u of urls) {
    if (!isImageUrlAllowed(u)) {
      return { ok: false, badUrl: u };
    }
  }
  return { ok: true };
}
