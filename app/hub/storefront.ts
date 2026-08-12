export type StorefrontItem = {
  id: number;
  canonicalUrl: string;
  code: string | null;
  slug: string | null;
  title: string | null;
  originalTitle: string | null;
  synopsis: string | null;
  releaseDate: string | null;
  durationSeconds: number | null;
  language: string | null;
  isSeries: boolean;
  coverUrl: string | null;
  playerStatus: "pass" | "blocked" | "error" | "expired" | "unknown" | null;
  playerType: "hls" | "mp4" | "embed" | "unknown" | null;
  playerPageUrl: string | null;
  mediaUrl: string | null;
  origin: string | null;
  referer: string | null;
  provider: string | null;
  hasPlayer: boolean;
  sourceCount: number;
};

export type StorefrontDetail = StorefrontItem & {
  images: Array<{ kind: string; url: string; sortOrder: number }>;
  localizations: Array<{
    locale: string;
    title: string | null;
    originalTitle: string | null;
    synopsis: string | null;
  }>;
  people: Array<{ name: string; role: string; profileUrl: string | null }>;
  terms: Array<{ name: string; type: string; url: string | null }>;
};

export function displayTitle(item: Pick<StorefrontItem, "title" | "originalTitle" | "code">) {
  return item.title || item.originalTitle || item.code || "รายการแนะนำ";
}

export function imageUrl(url: string | null | undefined) {
  return url ? `/api/catalog/image?url=${encodeURIComponent(url)}` : "/cover-fallback.svg";
}

export function durationLabel(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return "ความยาวไม่ระบุ";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} ชม. ${minutes} นาที` : `${minutes} นาที`;
}

export function yearLabel(date: string | null | undefined) {
  return date ? new Date(date).getFullYear().toString() : "ใหม่ล่าสุด";
}

export function viewerStatus(item: Pick<StorefrontItem, "hasPlayer" | "playerStatus">) {
  if (item.playerStatus === "pass" && item.hasPlayer) return "พร้อมรับชม";
  if (item.playerStatus === "blocked") return "กำลังตรวจสอบเรื่องนี้";
  if (item.playerStatus === "error" || item.playerStatus === "expired") return "กำลังซ่อมเรื่องนี้";
  return "กำลังเตรียมเรื่องนี้";
}
