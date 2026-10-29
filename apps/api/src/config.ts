import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: resolve(ROOT_DIR, '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('2h'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  AGENT_URL: z.string().url().default('http://localhost:8000'),
  AGENT_API_KEY: z.string().default('dev-agent-key'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  // Gmail rejects an unverified From address. When unset, send from SMTP_USER.
  MAIL_FROM: z.string().default(''),
  EVIDENCE_DIR: z.string().default('.data/evidence'),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(5),
  APP_DOWNLOAD_URL: z.string().default('http://localhost:3000/download'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  /** Chrome extension IDs allowed to call the API; the default is the ID fixed by apps/extension/manifest.json's key. */
  EXTENSION_IDS: z.string().default('fgfompcfejncbbpbipjokoniblfihbnm'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid API environment. Fix these values in .env:\n${lines}`);
  process.exit(1);
}

const env = parsed.data;
if (env.NODE_ENV === 'production' && ['change_me', 'dev-agent-key'].some((weak) => [env.JWT_SECRET, env.AGENT_API_KEY].includes(weak))) {
  console.error('Refusing to start in production with the default JWT_SECRET or AGENT_API_KEY.');
  process.exit(1);
}

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  clientOrigins: env.CLIENT_URL.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  extensionOrigins: env.EXTENSION_IDS.split(',').map((s) => s.trim()).filter(Boolean).map((id) => `chrome-extension://${id}`),
  evidenceDir: resolve(ROOT_DIR, env.EVIDENCE_DIR),
  smtpEnabled: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
};

for (const origin of config.clientOrigins) {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error(`CLIENT_URL must contain valid http(s) URL(s): ${origin}`);
  }
}
