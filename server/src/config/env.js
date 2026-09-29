import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 5000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/unified_interview',
  accessSecret: process.env.JWT_ACCESS_SECRET ?? 'development-only-access-secret-change-me',
  inviteSecret: process.env.JWT_INVITE_SECRET ?? process.env.JWT_ACCESS_SECRET ?? 'development-only-invite-secret-change-me',
  inviteTtl: process.env.JWT_INVITE_TTL ?? '7d',
  hostAbsenceGraceSeconds: Number(process.env.HOST_ABSENCE_GRACE_SECONDS ?? 300),
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'development-only-refresh-secret-change-me',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
  codeExecutionUrl: process.env.CODE_EXECUTION_URL ?? 'http://127.0.0.1:2000/api/v2/execute'
};
