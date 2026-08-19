/**
 * All configuration comes from the environment — nothing is read from disk and
 * no path is baked in. That is what lets the same build run from a Claude Code
 * stdio launch on a laptop, a systemd unit on the home server, or a container,
 * with only the env differing.
 *
 * Only the main site's ADMIN_KEY is required. The truman and listen keys are
 * optional: their tools always register, but calls fail with a clear "set this
 * env var" message until the key is provided.
 */
export type Config = {
  siteUrl: string;
  adminKey: string;
  trumanUrl: string;
  trumanOwnerKey: string | null;
  listenUrl: string;
  listenOwnerKey: string | null;
  /** todo/coffee/oddjob share the main site's ADMIN_KEY; only their URLs vary. */
  todoUrl: string;
  coffeeUrl: string;
  oddjobUrl: string;
  leetUrl: string;
  /** leet has its own ADMIN_KEY (not the shared one); optional like the truman key. */
  leetAdminKey: string | null;
  requestTimeoutMs: number;
};

function parseUrl(name: string, raw: string): string {
  const url = raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be http or https, got ${parsed.protocol}`);
  }
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const siteUrl = parseUrl("SITE_URL", env.SITE_URL ?? "https://justin06lee.dev");
  const trumanUrl = parseUrl("TRUMAN_URL", env.TRUMAN_URL ?? "https://truman.justin06lee.dev");
  const listenUrl = parseUrl("LISTEN_URL", env.LISTEN_URL ?? "https://listen.justin06lee.dev");
  const todoUrl = parseUrl("TODO_URL", env.TODO_URL ?? "https://todo.justin06lee.dev");
  const coffeeUrl = parseUrl("COFFEE_URL", env.COFFEE_URL ?? "https://coffee.justin06lee.dev");
  const oddjobUrl = parseUrl("ODDJOB_URL", env.ODDJOB_URL ?? "https://oddjob.justin06lee.dev");
  const leetUrl = parseUrl("LEET_URL", env.LEET_URL ?? "https://leet.justin06lee.dev");

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

  return {
    siteUrl,
    adminKey,
    trumanUrl,
    trumanOwnerKey: env.TRUMAN_OWNER_KEY || null,
    listenUrl,
    listenOwnerKey: env.LISTEN_OWNER_KEY || null,
    todoUrl,
    coffeeUrl,
    oddjobUrl,
    leetUrl,
    leetAdminKey: env.LEET_ADMIN_KEY || null,
    requestTimeoutMs,
  };
}
