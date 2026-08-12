export const PUBLIC_CURATED_CODES = [
  "mide-540-english-subtitle",
  "huntc-135",
  "ekdv-181",
  "dvmm-184-uncensored-leak",
  "honb-280-uncensored-leak",
  "mium-1037-uncensored-leak",
  "jur-378-uncensored-leak",
  "dvmm-225-uncensored-leak",
  "fc2-ppv-4959142",
  "fc2-ppv-4959070",
  "xrw-122",
  "real-629-uncensored-leak",
  "apd-173",
  "ssni-389",
] as const;

const curatedCodeOrder = new Map<string, number>(PUBLIC_CURATED_CODES.map((code, index) => [code, index]));

export function isPublicCuratedCode(code: string | null | undefined) {
  return Boolean(code && curatedCodeOrder.has(code.trim().toLowerCase()));
}

export function publicCuratedOrder(code: string | null | undefined) {
  return curatedCodeOrder.get(code?.trim().toLowerCase() || "") ?? Number.MAX_SAFE_INTEGER;
}
