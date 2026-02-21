export function resolveConvexSiteUrl() {
  if (process.env.NEXT_PUBLIC_CONVEX_URL?.endsWith(".convex.cloud")) {
    return process.env.NEXT_PUBLIC_CONVEX_URL.replace(
      ".convex.cloud",
      ".convex.site",
    );
  }

  if (process.env.NEXT_PUBLIC_CONVEX_SITE_URL) {
    return process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  }

  return null;
}
