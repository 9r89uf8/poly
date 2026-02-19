"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo } from "react";

function resolveConvexUrl() {
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    return process.env.NEXT_PUBLIC_CONVEX_URL;
  }

  const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!siteUrl) {
    return null;
  }

  if (siteUrl.endsWith(".convex.site")) {
    return siteUrl.replace(".convex.site", ".convex.cloud");
  }

  return null;
}

export default function ConvexClientProvider({ children }) {
  const convexUrl = resolveConvexUrl();

  const client = useMemo(() => {
    if (!convexUrl) {
      return null;
    }
    return new ConvexReactClient(convexUrl);
  }, [convexUrl]);

  if (!client) {
    return (
      <section className="panel">
        <p className="stat-label">Convex Not Configured</p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Missing `NEXT_PUBLIC_CONVEX_URL` (or `NEXT_PUBLIC_CONVEX_SITE_URL`) in the deployment environment.
        </p>
      </section>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
