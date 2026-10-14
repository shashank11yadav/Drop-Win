import * as z from 'zod/mini';

const origin = z.string().check(
  z.refine((value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  }, 'must be a bare origin such as https://example.com'),
);

const EnvSchema = z.object({
  APP_ENV: z._default(z.enum(['development', 'test', 'production']), 'development'),
  SESSION_SECRET: z.optional(z.string().check(z.minLength(32))),
  ALLOWED_ORIGINS: z._default(z.string(), ''),
  COOKIE_SAMESITE: z._default(z.enum(['Strict', 'Lax', 'None']), 'Strict'),
});

export interface AppConfig {
  appEnv: 'development' | 'test' | 'production';
  sessionSecret: string;
  /** Extra origins allowed to call the API with credentials. Same-origin is always allowed. */
  allowedOrigins: string[];
  cookieSameSite: 'Strict' | 'Lax' | 'None';
  /** Secure cookies use the __Host- prefix, which browsers only accept over HTTPS. */
  cookieSecure: boolean;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Validates environment variables. A missing SESSION_SECRET is only tolerated
 * outside production, where a random one is generated per process.
 */
export function loadConfig(env: Record<string, unknown>): {
  config: AppConfig;
  warnings: string[];
} {
  // Treat VAR= the same as an unset variable, which is how .env.example ships.
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`invalid environment: ${details}`);
  }
  const values = parsed.data;
  const warnings: string[] = [];

  const allowedOrigins = values.ALLOWED_ORIGINS.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of allowedOrigins) {
    if (!origin.safeParse(entry).success) {
      throw new ConfigError(`ALLOWED_ORIGINS entry "${entry}" is not a bare origin`);
    }
  }

  let sessionSecret = values.SESSION_SECRET;
  if (!sessionSecret) {
    if (values.APP_ENV === 'production') {
      throw new ConfigError('SESSION_SECRET is required in production (32+ characters)');
    }
    sessionSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    warnings.push('SESSION_SECRET not set; using a random secret, sessions reset on restart');
  }

  const production = values.APP_ENV === 'production';
  return {
    config: {
      appEnv: values.APP_ENV,
      sessionSecret,
      allowedOrigins,
      cookieSameSite: values.COOKIE_SAMESITE,
      // SameSite=None is rejected by browsers unless the cookie is Secure.
      cookieSecure: production || values.COOKIE_SAMESITE === 'None',
    },
    warnings,
  };
}
