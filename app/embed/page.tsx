import EmbedPlayer from "./embed-player";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function valueOf(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function EmbedPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const url = valueOf(params.url);
  const origin = valueOf(params.origin);
  const referer = valueOf(params.referer);
  const userAgent = valueOf(params.ua);
  const autoplay = valueOf(params.autoplay) === "1";

  return (
    <EmbedPlayer
      url={url}
      origin={origin}
      referer={referer}
      userAgent={userAgent}
      autoplay={autoplay}
    />
  );
}
