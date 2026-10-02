import http from 'node:http';
import { Server } from 'socket.io';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { registerSocketHandlers } from './realtime/registerSocketHandlers.js';
import { beginStartupHostRecoveryWindow, expireCodingRounds, refreshDueMeetingLifecycles } from './services/meetingLifecycleService.js';

const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: true, credentials: true } });
app.set('io', io);
registerSocketHandlers(io);

connectDatabase().then(async () => { await beginStartupHostRecoveryWindow(); await refreshDueMeetingLifecycles(); await expireCodingRounds(io); setInterval(() => refreshDueMeetingLifecycles().catch(error => console.error('Meeting lifecycle refresh failed', error)), 60_000).unref(); setInterval(() => expireCodingRounds(io).catch(error => console.error('Coding timer refresh failed', error)), 5_000).unref(); server.listen(env.port, () => console.info(`API listening on :${env.port}`)); }).catch((error) => { console.error('Database connection failed', error); process.exit(1); });
