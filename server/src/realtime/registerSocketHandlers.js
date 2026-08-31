import { Meeting } from '../models/Meeting.js';
import { MeetingMember } from '../models/MeetingMember.js';
import { Problem } from '../models/Problem.js';
import { CollaborativeDraft } from '../models/CollaborativeDraft.js';
import { User } from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';

export function registerSocketHandlers(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error('Authentication required');
      const payload = verifyAccessToken(token);
      const user = await User.findOne({ _id: payload.sub, accountStatus: 'active', deletedAt: null }).lean();
      if (!user) throw new Error('Account unavailable');
      socket.data.user = { id: user._id.toString(), name: user.name, avatarUrl: user.avatarUrl };
      next();
    } catch { next(new Error('Unauthorized socket connection')); }
  });

  io.on('connection', (socket) => {
    socket.on('room:join', async ({ meetingCode }, acknowledge = () => {}) => {
      try {
        const meeting = await Meeting.findOne({ meetingCode, deletedAt: null, status: { $ne: 'ended' } }).lean();
        if (!meeting) throw new Error('Meeting is unavailable');
        const member = await MeetingMember.findOne({ meetingId: meeting._id, userId: socket.data.user.id, membershipStatus: 'approved' }).lean();
        if (!member) throw new Error('Meeting approval is required');
        const room = `meeting:${meeting._id}`;
        const existingSockets = await io.in(room).fetchSockets();
        for (const existing of existingSockets.filter(peer => peer.data.user?.id === socket.data.user.id)) {
          existing.emit('room:replaced', { message: 'This account joined the meeting from another tab.' });
          leaveRoom(existing);
        }
        const occupants = await io.in(room).fetchSockets();
        const peers = occupants.map(peer => ({ socketId: peer.id, user: peer.data.user }));
        socket.join(room); socket.data.room = room; socket.data.meetingId = meeting._id.toString();
        socket.emit('room:peers', peers);
        socket.to(room).emit('peer:joined', { socketId: socket.id, user: socket.data.user });
        acknowledge({ ok: true, meeting: { title: meeting.title, type: meeting.type }, role: member.role });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    const relay = (event) => socket.on(event, ({ target, payload }) => {
      if (!socket.data.room) return;
      const targetSocket = io.sockets.sockets.get(target);
      if (!targetSocket || !targetSocket.rooms.has(socket.data.room)) return;
      targetSocket.emit(event, { sender: socket.id, user: socket.data.user, payload });
    });
    relay('webrtc:offer'); relay('webrtc:answer'); relay('webrtc:ice');

    socket.on('room:chat', ({ message }, acknowledge = () => {}) => {
      if (!socket.data.room || typeof message !== 'string') return acknowledge({ ok: false, message: 'Invalid chat message.' });
      const text = message.trim();
      if (!text || text.length > 2000) return acknowledge({ ok: false, message: 'Messages must be between 1 and 2,000 characters.' });
      io.to(socket.data.room).emit('room:chat', { id: `${socket.id}-${Date.now()}`, message: text, user: socket.data.user, sentAt: new Date().toISOString() });
      acknowledge({ ok: true });
    });

    socket.on('code:join', async ({ meetingCode, problemId, language }, acknowledge = () => {}) => {
      try {
        if (!meetingCode || !['javascript', 'python', 'cpp'].includes(language)) throw new Error('Invalid collaborative editor request.');
        const meeting = await Meeting.findOne({ meetingCode, deletedAt: null, status: { $ne: 'ended' } }).lean();
        if (!meeting || !await MeetingMember.exists({ meetingId: meeting._id, userId: socket.data.user.id, membershipStatus: 'approved' })) throw new Error('Meeting approval is required.');
        const meetingId = meeting._id.toString();
        const problem = await Problem.findOne({ _id: problemId, meetingId }).lean();
        if (!problem || !problem.allowedLanguages.includes(language)) throw new Error('Problem or language is unavailable.');
        const codeRoom = `code:${meetingId}:${problemId}:${language}`;
        socket.join(codeRoom);
        socket.data.codeMeetingId = meetingId;
        const draft = await CollaborativeDraft.findOne({ meetingId, problemId, language }).lean();
        acknowledge({ ok: true, sourceCode: draft?.sourceCode ?? '' });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('code:update', async ({ problemId, language, sourceCode }, acknowledge = () => {}) => {
      try {
        if (!socket.data.codeMeetingId || !['javascript', 'python', 'cpp'].includes(language) || typeof sourceCode !== 'string' || sourceCode.length > 100000) throw new Error('Invalid code update.');
        const codeRoom = `code:${socket.data.codeMeetingId}:${problemId}:${language}`;
        if (!socket.rooms.has(codeRoom)) throw new Error('Join the editor before sending updates.');
        await CollaborativeDraft.findOneAndUpdate({ meetingId: socket.data.codeMeetingId, problemId, language }, { $set: { sourceCode, updatedBy: socket.data.user.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
        socket.to(codeRoom).emit('code:update', { problemId, language, sourceCode, user: socket.data.user });
        acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('room:leave', () => leaveRoom(socket));
    socket.on('disconnect', () => leaveRoom(socket));
  });

  function leaveRoom(socket) {
    if (!socket.data.room) return;
    socket.to(socket.data.room).emit('peer:left', { socketId: socket.id });
    socket.leave(socket.data.room); delete socket.data.room; delete socket.data.meetingId;
  }
}
