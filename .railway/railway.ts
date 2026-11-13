import { defineRailway, project, service } from "railway/iac";

/**
 * Railway Infrastructure as Code for the `web` service (replaces railway.json).
 *
 * This repository owns the `web` and `backup` services (named partial). The Postgres
 * service and every environment variable are managed in the Railway dashboard and are
 * never touched from here (`variables: { managed: false }`).
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
  /**
   * Nightly encrypted database backup to R2 (OPS-4; see docs/backups.md). A cron service:
   * runs docker/backup/backup.sh at 08:00 UTC (2-3am in Lincoln), then exits.
   */
  const backup = service("backup", {
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "docker/backup/Dockerfile",
    },
    deploy: {
      cronSchedule: "0 8 * * *",
      restartPolicyType: "NEVER",
    },
  });
  return project("the-leftovers-site", {
    variables: { managed: false },
    resources: [web, backup],
  });
});
