import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.schema';

/** Everything with no default — the smallest environment that starts. */
const MINIMAL = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-secret-that-is-at-least-32-characters-long',
  CLICK_SIGNING_SECRET: 'a-click-secret-at-least-32-characters-long',
};

/**
 * Environment validation runs before the Nest application is created, so
 * these rules are the difference between a process that refuses to start and
 * one that fails later on whichever request first needs a missing value.
 */
describe('loadEnv', () => {
  it('accepts a minimal environment and fills in defaults', () => {
    const env = loadEnv(MINIMAL as NodeJS.ProcessEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_ROLE).toBe('api');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_CONNECT_TIMEOUT).toBe(10);
  });

  describe('PUBLIC_APP_URL and SMTP', () => {
    const smtp = {
      ...MINIMAL,
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'gemone <no-reply@example.com>',
    };

    it('defaults the public origin to the development address of web', () => {
      // So a developer needs nothing set for links in the log to be clickable.
      expect(loadEnv(MINIMAL as NodeJS.ProcessEnv).PUBLIC_APP_URL).toBe('http://localhost:5173');
    });

    it('strips a trailing slash, so links never contain a double slash', () => {
      const env = loadEnv({ ...MINIMAL, PUBLIC_APP_URL: 'https://gemone.example/' } as NodeJS.ProcessEnv);

      expect(env.PUBLIC_APP_URL).toBe('https://gemone.example');
    });

    it('rejects an origin that is not an absolute URL', () => {
      expect(() => loadEnv({ ...MINIMAL, PUBLIC_APP_URL: 'gemone.example' } as NodeJS.ProcessEnv)).toThrow(
        /PUBLIC_APP_URL/,
      );
    });

    it('runs on the logging provider when no SMTP host is set', () => {
      expect(loadEnv(MINIMAL as NodeJS.ProcessEnv).SMTP_HOST).toBeUndefined();
    });

    it('accepts a complete SMTP configuration', () => {
      const env = loadEnv(smtp as NodeJS.ProcessEnv);

      expect(env.SMTP_HOST).toBe('smtp.example.com');
      expect(env.SMTP_PORT).toBe(587);
    });

    it('refuses a host with no sender address', () => {
      /*
       * Otherwise the process starts, accepts registrations, and fails every
       * send inside a retrying queue — the worst place for a configuration
       * mistake to surface.
       */
      const { SMTP_FROM: _omitted, ...incomplete } = smtp;

      expect(() => loadEnv(incomplete as NodeJS.ProcessEnv)).toThrow(/SMTP_FROM/);
    });

    it('refuses SMTP settings with no host', () => {
      const { SMTP_HOST: _omitted, ...orphaned } = smtp;

      expect(() => loadEnv(orphaned as NodeJS.ProcessEnv)).toThrow(/SMTP_HOST/);
    });

    it('refuses half a credential pair', () => {
      expect(() =>
        loadEnv({ ...smtp, SMTP_USER: 'mailer' } as NodeJS.ProcessEnv),
      ).toThrow(/SMTP_USER and SMTP_PASSWORD/);
    });
  });

  describe('DATABASE_URL', () => {
    it('is required — there is deliberately no localhost fallback', () => {
      expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    });

    it('rejects an empty value', () => {
      expect(() => loadEnv({ DATABASE_URL: '' } as NodeJS.ProcessEnv)).toThrow(
        /DATABASE_URL/,
      );
    });

    it('rejects a connection string for the wrong database entirely', () => {
      expect(() =>
        loadEnv({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db' } as NodeJS.ProcessEnv),
      ).toThrow(/postgres/);
    });

    it('accepts both postgres:// and postgresql:// spellings', () => {
      expect(() =>
        loadEnv({ ...MINIMAL, DATABASE_URL: 'postgres://u:p@h:5432/d' } as NodeJS.ProcessEnv),
      ).not.toThrow();
      expect(() =>
        loadEnv({ ...MINIMAL, DATABASE_URL: 'postgresql://u:p@h:5432/d' } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

  describe('REDIS_URL', () => {
    it('is required — there is deliberately no localhost fallback', () => {
      /*
       * The same reasoning as DATABASE_URL, with a quieter failure mode: a
       * process that silently falls back to a local Redis enqueues scheduled
       * work into an instance nothing consumes, so the catalog simply stops
       * updating and no error is ever raised.
       */
      const { REDIS_URL: _omitted, ...withoutRedis } = MINIMAL;

      expect(() => loadEnv(withoutRedis as NodeJS.ProcessEnv)).toThrow(/REDIS_URL/);
    });

    it('rejects a connection string for something that is not Redis', () => {
      expect(() =>
        loadEnv({ ...MINIMAL, REDIS_URL: 'http://localhost:6379' } as NodeJS.ProcessEnv),
      ).toThrow(/redis/);
    });

    it('accepts the TLS spelling', () => {
      expect(() =>
        loadEnv({ ...MINIMAL, REDIS_URL: 'rediss://user:pass@host:6380' } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

  describe('pool sizing', () => {
    it('coerces the numeric strings that environments actually provide', () => {
      const env = loadEnv({ ...MINIMAL, DATABASE_POOL_MAX: '25' } as NodeJS.ProcessEnv);

      expect(env.DATABASE_POOL_MAX).toBe(25);
    });

    it('rejects a pool size that would exhaust the database', () => {
      expect(() =>
        loadEnv({ ...MINIMAL, DATABASE_POOL_MAX: '5000' } as NodeJS.ProcessEnv),
      ).toThrow(/DATABASE_POOL_MAX/);
    });

    it('rejects zero and negative pool sizes', () => {
      expect(() =>
        loadEnv({ ...MINIMAL, DATABASE_POOL_MAX: '0' } as NodeJS.ProcessEnv),
      ).toThrow(/DATABASE_POOL_MAX/);
      expect(() =>
        loadEnv({ ...MINIMAL, DATABASE_POOL_MAX: '-1' } as NodeJS.ProcessEnv),
      ).toThrow(/DATABASE_POOL_MAX/);
    });
  });

  it('rejects an unknown NODE_ENV rather than guessing', () => {
    expect(() =>
      loadEnv({ ...MINIMAL, NODE_ENV: 'staging' } as NodeJS.ProcessEnv),
    ).toThrow(/NODE_ENV/);
  });

  it('reports every problem at once, not just the first', () => {
    let message = '';
    try {
      loadEnv({ NODE_ENV: 'nope', LOG_LEVEL: 'loud' } as NodeJS.ProcessEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // Fixing one variable per restart is a miserable way to configure a
    // deploy, so the schema is not allowed to short-circuit.
    expect(message).toMatch(/NODE_ENV/);
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).toMatch(/DATABASE_URL/);
  });

  describe('JWT_SECRET', () => {
    it('is required', () => {
      const { JWT_SECRET: _omitted, ...withoutSecret } = MINIMAL;

      expect(() => loadEnv(withoutSecret as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    });

    it('rejects a short secret', () => {
      // A short signing key is brute-forceable offline against any captured
      // token, and a token forged with a recovered key is indistinguishable
      // from a real one.
      expect(() =>
        loadEnv({ ...MINIMAL, JWT_SECRET: 'too-short' } as NodeJS.ProcessEnv),
      ).toThrow(/JWT_SECRET/);
      expect(() =>
        loadEnv({ ...MINIMAL, JWT_SECRET: 'a'.repeat(31) } as NodeJS.ProcessEnv),
      ).toThrow(/JWT_SECRET/);
    });

    it('accepts exactly 32 characters', () => {
      expect(() =>
        loadEnv({ ...MINIMAL, JWT_SECRET: 'a'.repeat(32) } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

  describe('session lifetimes', () => {
    it('defaults the access token to 15 minutes and refresh to 30 days', () => {
      const env = loadEnv(MINIMAL as NodeJS.ProcessEnv);

      expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
      expect(env.REFRESH_TTL_DAYS).toBe(30);
    });

    it('rejects a non-positive lifetime', () => {
      expect(() =>
        loadEnv({ ...MINIMAL, JWT_ACCESS_TTL_SECONDS: '0' } as NodeJS.ProcessEnv),
      ).toThrow(/JWT_ACCESS_TTL_SECONDS/);
    });
  });

  describe('production hardening', () => {
    const production = {
      ...MINIMAL,
      NODE_ENV: 'production',
      LOG_PRETTY: 'false',
      // Required there — see the SMTP tests below.
      SMTP_HOST: 'smtp.example.com',
      SMTP_FROM: 'gemone <no-reply@example.com>',
      // Required there too, and required to agree — see the origin tests.
      SITE_ADDRESS: 'gemone.example',
      PUBLIC_APP_URL: 'https://gemone.example',
    };

    it('defaults COOKIE_SECURE to true', () => {
      expect(loadEnv(MINIMAL as NodeJS.ProcessEnv).COOKIE_SECURE).toBe(true);
    });

    it('refuses to start in production with an insecure cookie', () => {
      // A session cookie sent over plaintext HTTP is a session anyone on the
      // path can take. Failing to boot beats running insecurely.
      expect(() =>
        loadEnv({ ...production, COOKIE_SECURE: 'false' } as NodeJS.ProcessEnv),
      ).toThrow(/COOKIE_SECURE/);
    });

    it('refuses to start in production with pretty logs', () => {
      expect(() =>
        loadEnv({ ...production, LOG_PRETTY: 'true' } as NodeJS.ProcessEnv),
      ).toThrow(/LOG_PRETTY/);
    });

    it('refuses to start in production with no SMTP host', () => {
      /*
       * The failure this closes: with no host the process starts happily on
       * `LoggingEmailProvider`, which writes the password-reset **link** into
       * the application log. Every reset then becomes an account takeover for
       * anyone who can read logs, and no user receives anything.
       */
      const { SMTP_HOST: _omitted, SMTP_FROM: _also, ...withoutSmtp } = production;

      expect(() => loadEnv(withoutSmtp as NodeJS.ProcessEnv)).toThrow(/SMTP_HOST is required in production/);
    });

    it('starts in production once SMTP is configured', () => {
      expect(() => loadEnv(production as NodeJS.ProcessEnv)).not.toThrow();
      expect(loadEnv(production as NodeJS.ProcessEnv).SMTP_HOST).toBe('smtp.example.com');
    });

    it('leaves development free to run with no mail account at all', () => {
      // P4: the verification flow stays completable from the log, with nothing
      // configured. The production rule above must not reach back into this.
      expect(() => loadEnv(MINIMAL as NodeJS.ProcessEnv)).not.toThrow();
      expect(loadEnv(MINIMAL as NodeJS.ProcessEnv).SMTP_HOST).toBeUndefined();
    });

    /**
     * The failure these close is quiet and total: the site loads, every page
     * renders, and every form post comes back 403 because SvelteKit compares
     * the browser's `Origin` against the one it was configured with. Neither
     * service logs anything, because from each one's point of view nothing is
     * wrong.
     */
    describe('SITE_ADDRESS and PUBLIC_APP_URL name one origin', () => {
      it('accepts a bare Caddy site address against the matching https URL', () => {
        // A scheme-less site address is Caddy's way of asking for HTTPS with a
        // certificate, so these are the same deployment, not two.
        expect(() => loadEnv(production as NodeJS.ProcessEnv)).not.toThrow();
      });

      it('accepts differences that do not change the origin', () => {
        const harmless = [
          ['gemone.example', 'https://gemone.example/'], // trailing slash
          ['https://gemone.example', 'https://gemone.example'], // spelled out
          ['https://gemone.example/', 'https://gemone.example'], // on the other side
          ['gemone.example:443', 'https://gemone.example'], // the port https implies
          ['GEMONE.example', 'https://gemone.example'], // host case
          ['gemone.example', 'https://gemone.example/app'], // a path is not an origin
        ] as const;

        for (const [SITE_ADDRESS, PUBLIC_APP_URL] of harmless) {
          expect(() =>
            loadEnv({ ...production, SITE_ADDRESS, PUBLIC_APP_URL } as NodeJS.ProcessEnv),
          ).not.toThrow();
        }
      });

      it('refuses a different hostname', () => {
        // The `www.` that someone adds to one value and not the other.
        expect(() =>
          loadEnv({
            ...production,
            SITE_ADDRESS: 'gemone.example',
            PUBLIC_APP_URL: 'https://www.gemone.example',
          } as NodeJS.ProcessEnv),
        ).toThrow(/same origin/);
      });

      it('refuses a different scheme', () => {
        // Caddy serves HTTPS for a bare hostname; an http:// link would be a
        // different origin to every browser.
        expect(() =>
          loadEnv({
            ...production,
            SITE_ADDRESS: 'gemone.example',
            PUBLIC_APP_URL: 'http://gemone.example',
          } as NodeJS.ProcessEnv),
        ).toThrow(/same origin/);
      });

      it('refuses a port that changes the origin', () => {
        expect(() =>
          loadEnv({
            ...production,
            SITE_ADDRESS: 'gemone.example',
            PUBLIC_APP_URL: 'https://gemone.example:8443',
          } as NodeJS.ProcessEnv),
        ).toThrow(/same origin/);
      });

      it('names both origins in the message, so the fix is obvious', () => {
        expect(() =>
          loadEnv({
            ...production,
            SITE_ADDRESS: 'gemone.example',
            PUBLIC_APP_URL: 'http://gemone.example',
          } as NodeJS.ProcessEnv),
        ).toThrow(/https:\/\/gemone\.example.*http:\/\/gemone\.example/);
      });

      it('refuses to start in production with no site address at all', () => {
        const { SITE_ADDRESS: _omitted, ...withoutSite } = production;

        expect(() => loadEnv(withoutSite as NodeJS.ProcessEnv)).toThrow(
          /SITE_ADDRESS is required in production/,
        );
      });

      it('refuses a site address it cannot read as an origin', () => {
        // Caddy's port-only form serves every hostname that reaches it, so
        // there is no origin to compare against and nothing to trust.
        for (const SITE_ADDRESS of [':443', 'https://']) {
          expect(() =>
            loadEnv({ ...production, SITE_ADDRESS } as NodeJS.ProcessEnv),
          ).toThrow(/SITE_ADDRESS must name one origin/);
        }
      });

      it('refuses a wildcard or multi-host site address', () => {
        /*
         * These parse — `https://*.gemone.example` is a URL as far as the
         * parser is concerned — so they are caught by the comparison rather
         * than by the reader, and the message names both sides either way.
         */
        for (const SITE_ADDRESS of ['*.gemone.example', 'gemone.example,other.example']) {
          expect(() =>
            loadEnv({ ...production, SITE_ADDRESS } as NodeJS.ProcessEnv),
          ).toThrow(/same origin/);
        }
      });

      it('leaves development alone, where the port mapping makes them differ', () => {
        /*
         * Not an oversight: the development stack publishes Caddy on 8080:80,
         * so its site address is `http://localhost` while the browser's origin
         * is `http://localhost:8080`. Enforcing this rule there would refuse to
         * start the one configuration that is known to work.
         */
        expect(() =>
          loadEnv({
            ...MINIMAL,
            NODE_ENV: 'development',
            SITE_ADDRESS: 'http://localhost',
            PUBLIC_APP_URL: 'http://localhost:8080',
          } as NodeJS.ProcessEnv),
        ).not.toThrow();

        // And with no site address set at all, which is the common case.
        expect(() => loadEnv(MINIMAL as NodeJS.ProcessEnv)).not.toThrow();
      });
    });

    it('allows both in development, where there is no TLS', () => {
      expect(() =>
        loadEnv({
          ...MINIMAL,
          NODE_ENV: 'development',
          COOKIE_SECURE: 'false',
          LOG_PRETTY: 'true',
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

  it('treats LOG_PRETTY as a boolean, not a truthy string', () => {
    expect(loadEnv({ ...MINIMAL, LOG_PRETTY: 'true' } as NodeJS.ProcessEnv).LOG_PRETTY).toBe(
      true,
    );
    expect(loadEnv({ ...MINIMAL, LOG_PRETTY: 'false' } as NodeJS.ProcessEnv).LOG_PRETTY).toBe(
      false,
    );
    // 'false' being truthy is a classic configuration bug; the schema rejects
    // anything it cannot interpret unambiguously.
    expect(() =>
      loadEnv({ ...MINIMAL, LOG_PRETTY: 'yes' } as NodeJS.ProcessEnv),
    ).toThrow(/LOG_PRETTY/);
  });
});
