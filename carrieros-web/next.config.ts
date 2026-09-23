import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Self-contained build for container deployment (ECS Express Mode) —
  // bundles only the production node_modules a request actually needs into
  // .next/standalone instead of shipping the full node_modules tree.
  output: "standalone",
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Source-map upload only happens when SENTRY_AUTH_TOKEN (plus SENTRY_ORG /
// SENTRY_PROJECT) is set in the build environment; otherwise this is a no-op
// wrapper and the build is unchanged.
export default withSentryConfig(withNextIntl(nextConfig), {
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
