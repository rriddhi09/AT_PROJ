import http from 'node:http';
import { Server } from 'socket.io';
import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { registerSocketHandlers } from './realtime/registerSocketHandlers.js';

const server = http.createServer(app);
export const io = new Server(server, { cors: { origin: env.clientOrigin, credentials: true } });
registerSocketHandlers(io);

connectDatabase().then(() => server.listen(env.port, () => console.info(`API listening on :${env.port}`))).catch((error) => { console.error('Database connection failed', error); process.exit(1); });
