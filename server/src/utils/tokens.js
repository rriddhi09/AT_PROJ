import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const signAccessToken = (user) =>
  jwt.sign({ sub: user._id.toString(), email: user.email }, env.accessSecret, {
    expiresIn: env.accessTtl,
  });
export const signRefreshToken = (user) =>
  jwt.sign({ sub: user._id.toString() }, env.refreshSecret, {
    expiresIn: `${env.refreshTtlDays}d`,
  });
export const verifyAccessToken = (token) => jwt.verify(token, env.accessSecret);
export const verifyRefreshToken = (token) =>
  jwt.verify(token, env.refreshSecret);
export const signMeetingInvite = (meeting) =>
  jwt.sign(
    {
      type: "meeting-invite",
      meetingId: meeting._id.toString(),
      meetingCode: meeting.meetingCode,
      version: meeting.inviteVersion ?? 1,
    },
    env.inviteSecret,
    { expiresIn: env.inviteTtl, audience: "meeting-invite" },
  );
export const verifyMeetingInvite = (token, meeting) => {
  const payload = jwt.verify(token, env.inviteSecret, {
    audience: "meeting-invite",
  });
  if (
    payload.type !== "meeting-invite" ||
    payload.meetingId !== meeting._id.toString() ||
    payload.meetingCode !== meeting.meetingCode ||
    (payload.version ?? 1) !== (meeting.inviteVersion ?? 1)
  )
    throw new Error("Invite token is invalid or has been revoked.");
  return payload;
};
export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: "/api/v1/auth",
  maxAge: env.refreshTtlDays * 24 * 60 * 60 * 1000,
});
export const clearRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: "/api/v1/auth",
});
