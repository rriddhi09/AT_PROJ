import 'dotenv/config';

const production = process.env.NODE_ENV === 'production';
const setting = (name, localDefault) => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (production) throw new Error(`${name} is required in production.`);
  return localDefault;
};

const clientOrigin = setting('CLIENT_ORIGIN', 'http://localhost:5173');
if (production && new URL(clientOrigin).protocol !== 'https:') throw new Error('CLIENT_ORIGIN must use HTTPS in production.');
const cookieSecure = production || process.env.COOKIE_SECURE === 'true';
if (production && process.env.COOKIE_SECURE === 'false') throw new Error('COOKIE_SECURE cannot be false in production.');
const secrets = [
  setting('JWT_ACCESS_SECRET', 'development-only-access-secret-change-me'),
  setting('JWT_REFRESH_SECRET', 'development-only-refresh-secret-change-me'),
  setting('JWT_INVITE_SECRET', 'development-only-invite-secret-change-me')
];
if (production && (new Set(secrets).size !== 3 || secrets.some(secret => secret.length < 32 || secret.startsWith('replace-with-')))) {
  throw new Error('Production JWT secrets must be three different random values of at least 32 characters.');
}

export const env = {
  port: Number(process.env.PORT ?? 5000),
  mongoUri: setting('MONGODB_URI', 'mongodb://127.0.0.1:27017/unified_interview'),
  clientOrigins: production ? [new URL(clientOrigin).origin] : [...new Set([new URL(clientOrigin).origin, 'http://localhost:5173', 'http://127.0.0.1:5173'])],
  cookieSecure,
  cookieSameSite: production ? 'none' : 'lax',
  accessSecret: secrets[0],
  inviteSecret: secrets[2],
  inviteTtl: process.env.JWT_INVITE_TTL ?? '7d',
  hostAbsenceGraceSeconds: Number(process.env.HOST_ABSENCE_GRACE_SECONDS ?? 300),
  refreshSecret: secrets[1],
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  codeExecutionUrl: process.env.CODE_EXECUTION_URL ?? 'http://127.0.0.1:2000/api/v2/execute'
};
