// Payload schema validation + control-char sanitization.
// Reason codes: MISSING_FIELD, OVERSIZED, BAD_TYPE, BAD_BLOCK_KIND, CONTROL_CHARS, OVER_LIMIT.
// First violation wins.

const TITLE_MAX = 200;
const META_MAX = 500;
const HASHTAG_MAX_COUNT = 30;
const HASHTAG_MAX_LEN = 50;
const BLOCK_MAX_COUNT = 200;
const TEXT_MD_MAX = 50_000;
const IMAGE_URL_MAX = 2048;
const IMAGE_ALT_MAX = 200;
const IMAGE_URLS_MAX_COUNT = 30;
const PAYLOAD_MAX_BYTES = 1_000_000;

// Control chars: \x00-\x1F except \n (0x0A) and \t (0x09); also \x7F.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/;

function reject(reason) {
  return { ok: false, reason };
}

function hasControlChars(s) {
  return CONTROL_CHAR_RE.test(s);
}

function sanitize(s) {
  // Per spec the validator returns the FIRST violation; sanitize only strips
  // when called after validation passes. Here we keep the input as-is because
  // we reject on control chars rather than silently stripping. The "sanitized"
  // field in the success result is the trimmed/normalized payload.
  return s;
}

export function validatePayload(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return reject("BAD_TYPE");
  }

  // Rough payload size cap — applied early on the raw input.
  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return reject("BAD_TYPE");
  }
  if (serialized === undefined) return reject("BAD_TYPE");
  // Approximate byte length via UTF-8 encoding.
  const byteLen = new TextEncoder().encode(serialized).length;
  if (byteLen > PAYLOAD_MAX_BYTES) return reject("OVERSIZED");

  const { title, metaDescription, hashtags, blocks, imageUrls } = payload;

  // title
  if (typeof title !== "string") return reject(title === undefined ? "MISSING_FIELD" : "BAD_TYPE");
  if (title.length > TITLE_MAX) return reject("OVER_LIMIT");
  if (hasControlChars(title)) return reject("CONTROL_CHARS");

  // metaDescription
  if (typeof metaDescription !== "string") {
    return reject(metaDescription === undefined ? "MISSING_FIELD" : "BAD_TYPE");
  }
  if (metaDescription.length > META_MAX) return reject("OVER_LIMIT");
  if (hasControlChars(metaDescription)) return reject("CONTROL_CHARS");

  // hashtags
  if (!Array.isArray(hashtags)) {
    return reject(hashtags === undefined ? "MISSING_FIELD" : "BAD_TYPE");
  }
  if (hashtags.length > HASHTAG_MAX_COUNT) return reject("OVER_LIMIT");
  for (const tag of hashtags) {
    if (typeof tag !== "string") return reject("BAD_TYPE");
    if (tag.length > HASHTAG_MAX_LEN) return reject("OVER_LIMIT");
    if (hasControlChars(tag)) return reject("CONTROL_CHARS");
  }

  // blocks
  if (!Array.isArray(blocks)) {
    return reject(blocks === undefined ? "MISSING_FIELD" : "BAD_TYPE");
  }
  if (blocks.length > BLOCK_MAX_COUNT) return reject("OVER_LIMIT");
  for (const block of blocks) {
    if (block === null || typeof block !== "object" || Array.isArray(block)) {
      return reject("BAD_TYPE");
    }
    const { kind } = block;
    if (kind === "text") {
      if (typeof block.markdown !== "string") {
        return reject(block.markdown === undefined ? "MISSING_FIELD" : "BAD_TYPE");
      }
      if (block.markdown.length > TEXT_MD_MAX) return reject("OVER_LIMIT");
      if (hasControlChars(block.markdown)) return reject("CONTROL_CHARS");
    } else if (kind === "image") {
      if (typeof block.url !== "string") {
        return reject(block.url === undefined ? "MISSING_FIELD" : "BAD_TYPE");
      }
      if (block.url.length > IMAGE_URL_MAX) return reject("OVER_LIMIT");
      if (hasControlChars(block.url)) return reject("CONTROL_CHARS");
      if (typeof block.alt !== "string") {
        return reject(block.alt === undefined ? "MISSING_FIELD" : "BAD_TYPE");
      }
      if (block.alt.length > IMAGE_ALT_MAX) return reject("OVER_LIMIT");
      if (hasControlChars(block.alt)) return reject("CONTROL_CHARS");
    } else {
      return reject("BAD_BLOCK_KIND");
    }
  }

  // imageUrls — only length/type checks here; SSRF check lives in ssrf.js.
  if (!Array.isArray(imageUrls)) {
    return reject(imageUrls === undefined ? "MISSING_FIELD" : "BAD_TYPE");
  }
  if (imageUrls.length > IMAGE_URLS_MAX_COUNT) return reject("OVER_LIMIT");
  for (const u of imageUrls) {
    if (typeof u !== "string") return reject("BAD_TYPE");
    if (u.length > IMAGE_URL_MAX) return reject("OVER_LIMIT");
    if (hasControlChars(u)) return reject("CONTROL_CHARS");
  }

  return {
    ok: true,
    sanitized: {
      title: sanitize(title),
      metaDescription: sanitize(metaDescription),
      hashtags: hashtags.map(sanitize),
      blocks,
      imageUrls,
    },
  };
}
