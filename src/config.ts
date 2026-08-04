/**
 * All configuration comes from the environment — nothing is read from disk and
 * no path is baked in. That is what lets the same build run from a Claude Code
 * stdio launch on a laptop, a systemd unit on the home server, or a container,
 * with only the env differing.
 */
export type Config = {
  siteUrl: string;
  adminKey: string;
  requestTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const siteUrl = (env.SITE_URL ?? "https://justin06lee.dev").replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error(`SITE_URL is not a valid URL: ${siteUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SITE_URL must be http or https, got ${parsed.protocol}`);
  }

  const adminKey = env.ADMIN_KEY ?? "";
  if (!adminKey) {
    throw new Error(
      "ADMIN_KEY is required. Set it to the same value the target site is deployed with.",
    );
  }

  const rawTimeout = env.REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = rawTimeout ? Number(rawTimeout) : 15_000;
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(`REQUEST_TIMEOUT_MS must be a positive number, got ${rawTimeout}`);
  }

  return { siteUrl, adminKey, requestTimeoutMs };
}
