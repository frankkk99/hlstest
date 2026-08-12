import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_IMAGE_HOSTS = ["fourhoi.com", "missav.ws", "missav123.com", "missav.com"];

function hostAllowed(hostname: string) {
  const configured = (process.env.ALLOWED_COVER_IMAGE_HOSTS || DEFAULT_IMAGE_HOSTS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url") || "";
  let target: URL;

  try {
    target = new URL(raw);
  } catch {
    return new NextResponse("Invalid image URL", { status: 400 });
  }

  if (target.protocol !== "https:" || !hostAllowed(target.hostname.toLowerCase())) {
    return new NextResponse("Image host is not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: "https://missav123.com/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
      },
      redirect: "manual",
      cache: "force-cache",
      signal: AbortSignal.timeout(8000),
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (!location) return new NextResponse(null, { status: upstream.status });
      const redirected = new URL(location, target);
      if (redirected.protocol !== "https:" || !hostAllowed(redirected.hostname.toLowerCase())) {
        return new NextResponse("Image redirect host is not allowed", { status: 403 });
      }
      const redirectedResponse = await fetch(redirected, {
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          Referer: "https://missav123.com/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
        },
        redirect: "manual",
        cache: "force-cache",
        signal: AbortSignal.timeout(8000),
      });
      if (!redirectedResponse.ok) return new NextResponse(null, { status: redirectedResponse.status });
      return imageResponse(redirectedResponse);
    }

    if (!upstream.ok) return new NextResponse(null, { status: upstream.status });

    return imageResponse(upstream);
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "Image request timed out" : "Image proxy failed";
    return new NextResponse(message, { status: 504 });
  }
}

async function imageResponse(upstream: Response) {

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return new NextResponse("Upstream did not return an image", { status: 415 });
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      "X-HLSTest-Image-Proxy": "true",
    });
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("ETag", etag);

    return new NextResponse(await upstream.arrayBuffer(), { status: 200, headers });
}
