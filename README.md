# Unified Interview Platform

MERN application for normal meetings and technical interviews. It includes JWT sessions, private-meeting approval, WebRTC media/signaling, screen sharing, Socket.IO room chat, Monaco code editing, collaborative saved drafts, and self-hosted Piston execution for JavaScript, Python, and C++.

## Local development

1. Copy `server/.env.example` to `server/.env` and set real secrets.
2. Start MongoDB (Atlas or local replica set).
3. Run `npm install` at the repository root.
4. Run `docker compose up -d` to start Piston, then install the languages you need inside it.
5. Run `npm run dev`.

The client runs at `http://localhost:5173`; API requests use `http://localhost:5000/api/v1` by default.

## Local code execution

Piston runs at `http://localhost:2000`. Install the interview languages once after the container starts:

```powershell
docker exec unified-interview-piston cli/index.js ppman install javascript python "c++"
```

## Production checklist

- Set distinct, high-entropy JWT secrets and `NODE_ENV=production`.
- Use HTTPS for the client/API and set `COOKIE_SECURE=true` with the exact `CLIENT_ORIGIN`.
- Run MongoDB with backups and a replica set when `MONGODB_USE_TRANSACTIONS=true` is desired.
- Configure a TURN server through the `VITE_TURN_*` values; STUN alone is not reliable across all networks.
- Keep Piston on an internal network and never expose port 2000 publicly.
- Put the API behind a reverse proxy with request-size limits, TLS, health checks, and centralized logs.

## Verification

1. Register a host and candidate in separate browser profiles.
2. Create a private technical interview; request and approve access.
3. Both users join the room, then test camera, microphone, chat, screen sharing, and leaving.
4. Create a problem. Open the same problem for both users and verify code changes appear within about one second.
5. Run and submit JavaScript, Python, and C++ code. Hidden cases are evaluated only by the server.
6. Open `/meetings/<meeting-code>/files` to upload/download shared files, or `/meetings/<meeting-code>/record` to make a local browser recording.
