import { defineRailway, project, service } from "railway/iac";

/**
 * Railway Infrastructure as Code for the `web` service (replaces railway.json).
 *
 * This repository owns only the `web` service (named partial). The Postgres service and
 * every environment variable are managed in the Railway dashboard and are never touched
 * from here (`variables: { managed: false }`).
 *
 *   railway config plan    # preview; safe
 *   railway config apply   # apply after reviewing the plan
 *
 * Railway doesn't read this file on deploy; `railway up` still builds from the repo.
 */
export const partial = "web";

export default defineRailway(() => {
  const web = service("web", {
    build: {
      builder: "RAILPACK",
      buildCommand: "pnpm run build",
    },
    deploy: {
      // Applies migrations, then starts Next.js (see package.json "start").
      startCommand: "pnpm run start",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 120,
      // Restart policy is Railway's default (ON_FAILURE); setting it explicitly shows as permanent drift.
      restartPolicyMaxRetries: 5,
    },
    replicas: { sfo: 1 },
    domains: ["theleftoversband.com", "www.theleftoversband.com"],
  });
  return project("the-leftovers-site", {
    variables: { managed: false },
    resources: [web],
  });
});
