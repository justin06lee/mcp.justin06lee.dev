import type { Config } from "./config.ts";

const SESSION_COOKIE = "admin_session";

/** An API call that came back non-2xx. Carries the status so tools can explain it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly method: string,
    readonly path: string,
  ) {
    super(`${method} ${path} → ${status}: ${body || "(empty body)"}`);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

/**
 * Talks to a justin06lee.dev deployment over its public HTTP API.
 *
 * Deliberately not a direct Turso client: the API routes own validation, the
 * category/plan foreign-key checks, and — critically — Next.js cache
 * revalidation. Writing to the database behind the app's back would change the
 * data and leave the site serving a stale cached page.
 *
 * The site authenticates with a session cookie and has no header-token path, so
 * this exchanges ADMIN_KEY for a cookie on first use and re-authenticates when
 * the 24h session lapses.
 */
export class SiteClient {
  #cookie: string | null = null;
  /** In-flight login, shared so concurrent tool calls trigger only one. */
  #loginInFlight: Promise<string> | null = null;

  constructor(private readonly config: Config) {}

  async #login(): Promise<string> {
    if (this.#loginInFlight) return this.#loginInFlight;

    this.#loginInFlight = (async () => {
      const res = await this.#fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: this.config.adminKey }),
      });

      if (res.status === 429) {
        throw new Error(
          "Login rate-limited by the site (10 attempts / 15 min, then a 24h lockout). " +
            "Wait it out — repeated retries extend the lockout.",
        );
      }
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? `ADMIN_KEY was rejected by ${this.config.siteUrl}. Check it matches that deployment.`
            : `Login to ${this.config.siteUrl} failed with ${res.status}.`,
        );
      }

      const token = res.headers
        .getSetCookie()
        .map((c) => /(?:^|;\s*)admin_session=([^;]*)/.exec(c)?.[1])
        .find((v): v is string => Boolean(v));

      if (!token) {
        throw new Error(
          `Login succeeded but no ${SESSION_COOKIE} cookie came back. ` +
            "If SITE_URL is http:// against a production build, the cookie is Secure and will be dropped.",
        );
      }

      this.#cookie = `${SESSION_COOKIE}=${token}`;
      return this.#cookie;
    })();

    try {
      return await this.#loginInFlight;
    } finally {
      this.#loginInFlight = null;
    }
  }

  #fetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.config.siteUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      redirect: "manual",
    });
  }

  /**
   * Perform an authenticated request. Retries exactly once on a 401 so an
   * expired session heals silently instead of surfacing as a tool failure —
   * but only once, so a genuinely bad key fails fast rather than looping into
   * the login rate limiter.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, query } = options;

    let url = path;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const send = async (cookie: string): Promise<Response> =>
      this.#fetch(url, {
        method,
        headers: {
          cookie,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    let cookie = this.#cookie ?? (await this.#login());
    let res = await send(cookie);

    if (res.status === 401) {
      this.#cookie = null;
      cookie = await this.#login();
      res = await send(cookie);
    }

    if (!res.ok) {
      throw new ApiError(res.status, (await res.text()).slice(0, 500), method, url);
    }

    // 204 is a documented success shape here — `GET /api/calendar/actuals/running`
    // returns it when no timer is going.
    if (res.status === 204) return null as T;

    const text = await res.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, `expected JSON, got: ${text.slice(0, 200)}`, method, url);
    }
  }
}
