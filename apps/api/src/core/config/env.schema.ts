import { z } from 'zod';

/**
 * Environment = INFRASTRUCTURE only.
 *
 * ARCHITECTURE.md §5.1 draws a hard line: anything a non-developer might need
 * to change, that alters user-visible behaviour or economics, is a business
 * rule and belongs in the ConfigurationService (database-backed, audited,
 * hot-reloaded). This schema holds only what breaks the *process* when wrong:
 * connection strings, ports, secrets.
 *
 * Adding a reward rate, hold period, or withdrawal limit here is a P3
 * violation, not a shortcut.
 */
export /**
 * An optional value where empty means absent.
 *
 * Docker Compose substitutes an unset variable as the **empty string**, so
 * `SMTP_HOST: ${SMTP_HOST:-}` arrives as `''` rather than missing. Without this
 * the stack would refuse to start with a message about a value nobody set.
 */
function optionalSecret() {
  return z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());
}

/**
 * The origin a site address denotes, or `null` if it denotes no single one.
 *
 * `SITE_ADDRESS` is a Caddy site address and `PUBLIC_APP_URL` is a URL, so the
 * two are compared as **origins** rather than as strings. `URL.origin`
 * collapses exactly the differences that do not matter — a trailing slash, a
 * path, an upper-case host, an explicit `:443` on an `https` URL — and keeps
 * the three that do: scheme, host, and a port the scheme does not already
 * imply.
 */
function originOf(value: string): string | null {
  // Caddy serves a scheme-less site address over HTTPS and obtains a
  // certificate for it, which is what makes `gemone.example` and
  // `https://gemone.example` the same deployment rather than two.
  const absolute = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const origin = new URL(absolute).origin;

    // A scheme the URL parser does not consider special — and a wildcard or
    // multi-address Caddy site — yields the literal string `null` here. Two
    // such values would otherwise compare equal to each other.
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  /** Which entrypoint this process is. Same image, two roles (§1.2). */
  APP_ROLE: z.enum(['api', 'worker']).default('api'),

  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * PostgreSQL connection string. Required and deliberately without a default
   * — a process that silently connects to localhost when the real value is
   * missing is a process that can write to the wrong database.
   */
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    ),

  /**
   * Maximum connections this process holds.
   *
   * Infrastructure, not a business rule: it is bounded by what the database
   * is configured to accept, and getting it wrong exhausts the connection
   * pool rather than changing anyone's rewards. Sized per process, so the
   * ceiling is this value multiplied by the number of api + worker replicas.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  /** Seconds to wait for a connection from the pool before giving up. */
  DATABASE_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(10),

  /**
   * Redis connection string — queues today, caching and rate limiting later.
   *
   * Required and without a default, for the same reason DATABASE_URL is: a
   * process that silently falls back to localhost is one that can enqueue
   * into the wrong instance, and a scheduled job dispatched against a
   * development Redis is a job production never runs.
   */
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .refine(
      (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
      'REDIS_URL must be a redis:// or rediss:// connection string',
    ),

  /**
   * Signing key for access tokens (HS256 — ARCHITECTURE.md §8.1).
   *
   * 32 characters minimum. A short secret is brute-forceable offline against
   * any captured token, and a token forged with a recovered key is
   * indistinguishable from a real one.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  /**
   * Signing key for `sub_id` — the opaque click identifier providers receive
   * (ARCHITECTURE.md §19.2).
   *
   * **Separate from JWT_SECRET on purpose.** They protect different things
   * with different lifetimes: an access token lives fifteen minutes, a click's
   * attribution window lives thirty days. Sharing one key would mean rotating
   * it for a session-security reason silently invalidated every outstanding
   * click, and every conversion still to arrive for them.
   */
  CLICK_SIGNING_SECRET: z
    .string()
    .min(32, 'CLICK_SIGNING_SECRET must be at least 32 characters'),

  /**
   * How many reverse proxies sit in front of this process.
   *
   * Zero by default, and that default is the safe one: with `trust proxy`
   * enabled, Express takes the client IP from `X-Forwarded-For`, which any
   * client can send. Trusting it when nothing is actually in front means a
   * caller picks their own IP — and the per-IP click limit, which exists to
   * bound exactly that kind of abuse, becomes decorative.
   *
   * Behind Caddy (§20.1) this is 1. Set it to the number of proxies you
   * control, never higher.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  /**
   * Access token lifetime.
   *
   * A security parameter, not a business rule: it trades revocation latency
   * against database load, and no admin has a reason to tune it (§5.1). Short
   * on purpose — a stateless JWT cannot be revoked, so suspension takes
   * effect within this window at worst.
   */
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  /** Refresh token lifetime, in days. Revocable, so it can be long. */
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * The public origin of the user-facing application.
   *
   * Emails carry links, and a link needs an origin the recipient's browser can
   * reach — which this process cannot infer, because it sits behind Caddy on
   * an internal network and knows only its own container name (§19.1).
   *
   * The default is the development address of `web`, so nothing has to be set
   * to work locally. Production must set it; a wrong value here sends every
   * verification and reset link to somewhere that is not us.
   */
  PUBLIC_APP_URL: z
    .string()
    .url('PUBLIC_APP_URL must be an absolute URL')
    .default('http://localhost:5173')
    .transform((value) => value.replace(/\/+$/, '')),

  /**
   * The site address Caddy serves on — the deployment's canonical origin.
   *
   * Not read by this process for anything: it is here to be **checked against**
   * `PUBLIC_APP_URL`. The two are set independently, in different services, and
   * a disagreement between them is invisible until a user submits a form.
   *
   * A Caddy site address, so a bare hostname is legal and means HTTPS — see
   * `originOf`. Optional outside production, where the development stack
   * deliberately does not satisfy this invariant (see the refinement below).
   */
  SITE_ADDRESS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),

  /**
   * SMTP — optional, and its absence is the switch.
   *
   * With no host configured, `notifications` resolves the logging provider and
   * a developer completes the verification flow by reading the link out of the
   * log. Set a host and the same interface starts delivering real mail. There
   * is no separate flag: a second thing to set is a second thing to set wrongly
   * (P6).
   *
   * **Optional in development only.** Production requires a host — see the
   * refinement below for why silence is the dangerous default there.
   *
   * Credentials, so environment and never configuration (§5.1).
   */
  SMTP_HOST: optionalSecret(),
  SMTP_PORT: z.coerce.number().int().positive().max(65_535).default(587),
  SMTP_USER: optionalSecret(),
  SMTP_PASSWORD: optionalSecret(),
  /** `Sender Name <address>` or a bare address. */
  SMTP_FROM: optionalSecret(),

  /**
   * `Secure` flag on the refresh cookie. Must be true in production —
   * a session cookie sent over plaintext HTTP is a session anyone on the
   * path can take. False only for local development without TLS.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Cookie domain. Omit to scope the cookie to the exact serving host. */
  COOKIE_DOMAIN: z.string().optional(),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  /**
   * Pretty-printed logs are for a human reading a terminal. Production emits
   * JSON to stdout (§16.1) and this must stay off there.
   */
  LOG_PRETTY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})
  /**
   * Settings that are merely inadvisable in development and unacceptable in
   * production. Enforced here so the process refuses to start rather than
   * running insecurely — a misconfiguration that only shows up as "sessions
   * are stealable" is one nobody notices until it is exploited.
   */
  .superRefine((env, ctx) => {
    /*
     * Partial SMTP settings are refused outright, in every environment.
     *
     * A host with no sender address is a process that starts, accepts
     * registrations, and fails every send — the failure lands in a retrying
     * queue rather than at startup, which is the worst place for it. The same
     * applies to half a credential pair.
     */
    if (env.SMTP_HOST && !env.SMTP_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_FROM'],
        message: 'SMTP_FROM is required when SMTP_HOST is set',
      });
    }

    if (!env.SMTP_HOST && (env.SMTP_USER || env.SMTP_PASSWORD || env.SMTP_FROM)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when any other SMTP_* value is set',
      });
    }

    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_PASSWORD'],
        message: 'SMTP_USER and SMTP_PASSWORD must be set together',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    /*
     * Production must have a way to actually deliver mail.
     *
     * Absent SMTP resolves `LoggingEmailProvider`, which is the right default
     * for development and an account-takeover path in production: it writes
     * `message.params` — including the password-reset **link** — into the
     * application log, so anyone who can read the logs can take any account by
     * asking for a reset. The quieter half is that nobody receives anything and
     * nothing says so.
     *
     * Enforced here rather than by a second flag: the absence of a host is
     * still the switch (P6), it is just no longer a switch production is
     * allowed to leave in the development position.
     */
    if (!env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message:
          'SMTP_HOST is required in production — without it, verification and password-reset links are written to the log instead of being delivered',
      });
    }

    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }

    if (env.LOG_PRETTY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOG_PRETTY'],
        message: 'LOG_PRETTY must be false in production — logs are JSON to stdout',
      });
    }

    /*
     * The public address, agreed on by the two services that decide it.
     *
     * `SITE_ADDRESS` is what Caddy answers on and obtains a certificate for;
     * `PUBLIC_APP_URL` is the origin the application tells browsers about — it
     * goes into every emailed link, and the production compose file passes it
     * to `web` as SvelteKit's `ORIGIN`. SvelteKit refuses any form post whose
     * `Origin` header does not match that value, so if the two disagree the
     * site loads, every page renders, and **every login, registration and
     * payout submission fails with a bare 403** — with nothing in either
     * service's log explaining why, because from each one's point of view
     * nothing is wrong.
     *
     * Checked here because this is the process that already validates its
     * environment, and it starts before `web` does (§20.2): a mismatch stops
     * the deploy instead of reaching the first user who tries to log in.
     *
     * **Production only, deliberately.** The development stack publishes Caddy
     * on `8080:80`, so its site address is `http://localhost` while the browser
     * — and therefore `ORIGIN` — is `http://localhost:8080`. That is a port
     * remapping, not a misconfiguration, and it does not exist in production
     * where Caddy holds 80 and 443 directly.
     */
    const siteOrigin = env.SITE_ADDRESS ? originOf(env.SITE_ADDRESS) : null;
    const appOrigin = originOf(env.PUBLIC_APP_URL);

    if (!env.SITE_ADDRESS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SITE_ADDRESS'],
        message:
          'SITE_ADDRESS is required in production — it is the origin Caddy serves, and the value PUBLIC_APP_URL is checked against',
      });
    } else if (siteOrigin === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['SITE_ADDRESS'],
        message: `SITE_ADDRESS must name one origin, so it can be compared with PUBLIC_APP_URL (got "${env.SITE_ADDRESS}")`,
      });
    } else if (appOrigin === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_APP_URL'],
        message: `PUBLIC_APP_URL must name one origin (got "${env.PUBLIC_APP_URL}")`,
      });
    } else if (siteOrigin !== appOrigin) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_APP_URL'],
        message: `PUBLIC_APP_URL and SITE_ADDRESS must be the same origin: Caddy serves ${siteOrigin}, PUBLIC_APP_URL says ${appOrigin}. Every form submission would be rejected with 403`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates and returns the environment, or throws with every problem listed.
 *
 * Called before the Nest application is created, so a misconfigured process
 * dies at startup with a readable message instead of failing later on the
 * first request that happens to need the missing value.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
