/**
 * HTTP clients for the justin06lee.dev ecosystem.
 *
 * Deliberately not direct Turso clients: the API routes own validation, the
 * foreign-key checks, and — critically — Next.js cache revalidation. Writing to
 * the database behind an app's back would change the data and leave the site
 * serving a stale cached page.
 *
 * Three auth models exist across the ecosystem, all cookie-based (no site has
 * a header-token path):
 *   - justin06lee.dev  — POST /api/auth {password} → `admin_session` cookie
 *   - truman           — POST /api/auth {password, name} → `truman_session`
 *   - listen           — no exchange; the cookie value IS the raw owner key
 */

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

export type RequestOptions = {
  method?: string;
  body?: unknown;
  /** multipart body — mutually exclusive with `body`. */
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
};

export interface ApiClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
}

abstract class CookieClient implements ApiClient {
  constructor(
    protected readonly baseUrl: string,
    protected readonly timeoutMs: number,
  ) {}

  /** Cookie header value for the next request, or null for anonymous. */
  protected abstract cookie(): Promise<string | null>;
  /** Called on a 401. Return a fresh cookie to retry once with, or null to give up. */
  protected abstract onUnauthorized(): Promise<string | null>;

  protected fetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "manual",
    });
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, form, query } = options;

    let url = path;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const send = async (cookie: string | null): Promise<Response> =>
      this.fetch(url, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          // multipart sets its own boundary header; JSON declares itself.
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(form !== undefined
          ? { body: form }
          : body !== undefined
            ? { body: JSON.stringify(body) }
            : {}),
      });

    let res = await send(await this.cookie());

    if (res.status === 401) {
      const fresh = await this.onUnauthorized();
      if (fresh !== null) res = await send(fresh);
    }

    if (!res.ok) {
      throw new ApiError(res.status, (await res.text()).slice(0, 500), method, url);
    }

    // 204 is a documented success shape — e.g. `GET /api/calendar/actuals/running`
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

export type SessionClientOptions = {
  baseUrl: string;
  key: string;
  timeoutMs: number;
  /** Session cookie the site sets on login, e.g. "admin_session". */
  cookieName: string;
  /** Login endpoint, e.g. "/api/auth". */
  loginPath: string;
  /** JSON body the login endpoint expects for this key. */
  loginBody: (key: string) => unknown;
};

/**
 * Password-for-cookie session auth (justin06lee.dev, truman). Logs in lazily on
 * first use and re-authenticates exactly once on a 401 so an expired session
 * heals silently — but only once, so a genuinely bad key fails fast rather than
 * looping into the sites' login rate limiters (10 attempts / 15 min, then a
 * 24h lockout — never add retry loops around auth).
 */
export class SessionClient extends CookieClient {
  #cookie: string | null = null;
  /** In-flight login, shared so concurrent tool calls trigger only one. */
  #loginInFlight: Promise<string> | null = null;

  constructor(private readonly options: SessionClientOptions) {
    super(options.baseUrl, options.timeoutMs);
  }

  protected async cookie(): Promise<string> {
    return this.#cookie ?? this.#login();
  }

  protected async onUnauthorized(): Promise<string> {
    this.#cookie = null;
    return this.#login();
  }

  async #login(): Promise<string> {
    if (this.#loginInFlight) return this.#loginInFlight;

    const { baseUrl, key, cookieName, loginPath, loginBody } = this.options;

    this.#loginInFlight = (async () => {
      const res = await this.fetch(loginPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(loginBody(key)),
      });

      if (res.status === 429) {
        throw new Error(
          `Login to ${baseUrl} rate-limited (10 attempts / 15 min, then a 24h lockout). ` +
            "Wait it out — repeated retries extend the lockout.",
        );
      }
      if (res.status === 503) {
        throw new Error(`${baseUrl} has no admin password configured server-side.`);
      }
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? `The admin key was rejected by ${baseUrl}. Check it matches that deployment.`
            : `Login to ${baseUrl} failed with ${res.status}.`,
        );
      }

      const pattern = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`);
      const token = res.headers
        .getSetCookie()
        .map((c) => pattern.exec(c)?.[1])
        .find((v): v is string => Boolean(v));

      if (!token) {
        throw new Error(
          `Login to ${baseUrl} succeeded but no ${cookieName} cookie came back. ` +
            "If the URL is http:// against a production build, the cookie is Secure and will be dropped.",
        );
      }

      this.#cookie = `${cookieName}=${token}`;
      return this.#cookie;
    })();

    try {
      return await this.#loginInFlight;
    } finally {
      this.#loginInFlight = null;
    }
  }
}

/**
 * Fixed-cookie auth (listen): the site compares the cookie value against its
 * owner key directly, so there is no exchange and nothing to refresh. A 401
 * means the key is wrong — retrying cannot help.
 */
export class StaticCookieClient extends CookieClient {
  constructor(
    baseUrl: string,
    timeoutMs: number,
    private readonly staticCookie: string | null,
  ) {
    super(baseUrl, timeoutMs);
  }

  protected async cookie(): Promise<string | null> {
    return this.staticCookie;
  }

  protected async onUnauthorized(): Promise<null> {
    return null;
  }
}
