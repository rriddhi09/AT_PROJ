import { Meeting } from '../models/Meeting.js';
import { MeetingMember } from '../models/MeetingMember.js';
import { Problem } from '../models/Problem.js';
import { CollaborativeDraft } from '../models/CollaborativeDraft.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/tokens.js';

export function registerSocketHandlers(io) {
  const whiteboards = new Map();
  const activeScreenShares = new Map();
  const raisedHands = new Map();
  const reconnectTimers = new Map();
  const hostAbsenceTimers = new Map();
  const fullHostPermissions = { microphone: true, camera: true, screenShare: true, whiteboard: ['VIEW', 'DRAW', 'EDIT', 'CLEAR', 'ADMIN'], chat: true, reactions: true, recording: true, files: true, canChat: true, canShareScreen: true, canUploadFiles: true, canStartRecording: true, canManageParticipants: true };
  const defaultParticipantPermissions = { microphone: true, camera: true, screenShare: false, whiteboard: ['VIEW'], chat: true, reactions: true, recording: false, files: false, canChat: true, canShareScreen: false, canUploadFiles: false, canStartRecording: false, canManageParticipants: false };
  const permissionsFor = (member) => ({
    microphone: member.permissions?.microphone ?? true,
    camera: member.permissions?.camera ?? true,
    screenShare: ['host', 'interviewer'].includes(member.role) ? true : (member.permissions?.screenShare ?? member.permissions?.canShareScreen ?? false),
    whiteboard: member.permissions?.whiteboard?.length ? member.permissions.whiteboard : ['VIEW'],
    chat: member.permissions?.chat ?? member.permissions?.canChat ?? true,
    reactions: member.permissions?.reactions ?? true,
    recording: member.permissions?.recording ?? member.permissions?.canStartRecording ?? false,
    files: member.permissions?.files ?? member.permissions?.canUploadFiles ?? false,
    canManageParticipants: member.permissions?.canManageParticipants ?? false
  });
  const participantInfo = socket => ({ ...socket.data.user, role: socket.data.role, permissions: socket.data.permissions, isPrimaryHost: Boolean(socket.data.isPrimaryHost), mediaState: socket.data.mediaState ?? { microphone: false, camera: false } });
  const chatPayload = item => { const senderId = item.senderId?.id ?? item.senderId?._id?.toString?.() ?? item.senderId?.toString?.(); return { id: item._id.toString(), message: item.message, private: Boolean(item.recipientId), user: { id: senderId, name: item.senderId?.name ?? 'Participant', avatarUrl: item.senderId?.avatarUrl }, senderId, recipientId: item.recipientId?.toString?.() ?? null, sentAt: item.createdAt.toISOString() }; };
  const canManage = socket => ['host', 'interviewer'].includes(socket.data.role) || socket.data.permissions?.canManageParticipants;
  const whiteboardAllows = (socket, permission) => canManage(socket) || socket.data.permissions?.whiteboard?.includes('ADMIN') || socket.data.permissions?.whiteboard?.includes(permission);
  const emitWhiteboard = async (room, event, payload) => { const sockets = await io.in(room).fetchSockets(); sockets.filter(peer => whiteboardAllows(peer, 'VIEW')).forEach(peer => peer.emit(event, payload)); };
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
        const meeting = await Meeting.findOne({ meetingCode, deletedAt: null, status: { $in: ['LIVE', 'PAUSED'] } }).lean();
        if (!meeting) throw new Error('Meeting is unavailable');
        if (meeting.scheduledAt && meeting.createdAt && new Date(meeting.scheduledAt).getTime() < new Date(meeting.createdAt).getTime()) throw new Error('This meeting was scheduled for a past date and cannot be joined.');
        const member = await MeetingMember.findOne({ meetingId: meeting._id, userId: socket.data.user.id, membershipStatus: 'approved' }).lean();
        if (!member) throw new Error('Meeting approval is required');
        if (['REMOVED', 'BANNED'].includes(member.participantStatus) || member.canRejoin === false) throw new Error(member.participantStatus === 'BANNED' ? 'You are blocked from this meeting.' : 'You were removed and cannot rejoin this meeting.');
        const room = `meeting:${meeting._id}`;
        const reconnectKey = `${meeting._id}:${socket.data.user.id}`;
        const pendingReconnect = reconnectTimers.get(reconnectKey); const restoringSession = Boolean(pendingReconnect);
        if (meeting.status === 'PAUSED' && !restoringSession) throw new Error('This meeting is paused. Wait for the host to resume it.');
        const existingSockets = await io.in(room).fetchSockets();
        const hostPresent = existingSockets.some(peer => ['host', 'interviewer'].includes(peer.data.role));
        if (meeting.locked && !restoringSession && !['host', 'interviewer'].includes(member.role)) throw new Error('The host has locked this meeting.');
        if (!restoringSession && !['host', 'interviewer'].includes(member.role) && meeting.settings?.allowJoinBeforeHost !== true && !hostPresent) throw new Error('Waiting for host to join the meeting.');
        for (const existing of existingSockets.filter(peer => peer.data.user?.id === socket.data.user.id)) {
          existing.emit('room:replaced', { message: 'This account joined the meeting from another tab.' });
          await leaveRoom(existing, { preserveStatus: true });
        }
        const occupants = await io.in(room).fetchSockets();
        const participantCount = occupants.filter(peer => !['host', 'interviewer'].includes(peer.data.role)).length;
        if (!restoringSession && !['host', 'interviewer'].includes(member.role) && participantCount >= (meeting.settings?.maxParticipants ?? 100)) throw new Error('Meeting capacity reached.');
        if (pendingReconnect) { clearTimeout(pendingReconnect); reconnectTimers.delete(reconnectKey); }
        const peers = occupants.map(peer => ({ socketId: peer.id, user: participantInfo(peer) }));
        socket.join(room); socket.data.room = room; socket.data.meetingId = meeting._id.toString(); socket.data.role = member.role; socket.data.permissions = permissionsFor(member); socket.data.meetingSettings = meeting.settings ?? {}; socket.data.isPrimaryHost = meeting.ownerId.toString() === socket.data.user.id; socket.data.mediaState = { microphone: false, camera: false };
        if (['host', 'interviewer'].includes(member.role)) await clearHostAbsence(meeting._id.toString(), room);
        const history = await ChatMessage.find({ meetingId: meeting._id, deletedAt: null, $or: [{ recipientId: null }, { senderId: socket.data.user.id }, { recipientId: socket.data.user.id }] }).sort({ createdAt: -1 }).limit(100).populate('senderId', 'name avatarUrl').lean();
        socket.emit('room:peers', peers);
        if (whiteboardAllows(socket, 'VIEW')) socket.emit('whiteboard:init', { active: whiteboards.has(meeting._id.toString()), strokes: whiteboards.get(meeting._id.toString()) ?? [] });
        socket.to(room).emit('peer:joined', { socketId: socket.id, user: participantInfo(socket) });
        await MeetingMember.updateOne({ meetingId: meeting._id, userId: socket.data.user.id }, { $set: { participantStatus: 'JOINED', joinedAt: new Date(), reconnectingAt: null, leftAt: null } });
        acknowledge({ ok: true, meeting: { title: meeting.title, type: meeting.type }, role: member.role, permissions: socket.data.permissions, isPrimaryHost: socket.data.isPrimaryHost, primaryHostUserId: meeting.ownerId.toString(), messages: history.reverse().map(chatPayload), activeScreenSharers: [...(activeScreenShares.get(socket.data.meetingId) ?? [])], recording: meeting.recording ?? { active: false }, controls: { locked: meeting.locked, chatMode: meeting.settings?.chatMode ?? 'EVERYONE', reactionsEnabled: meeting.settings?.reactionsEnabled !== false }, raisedHands: raisedHands.get(socket.data.meetingId) ?? [] });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    const relay = (event) => socket.on(event, ({ target, payload }) => {
      if (!socket.data.room) return;
      const targetSocket = io.sockets.sockets.get(target);
      if (!targetSocket || !targetSocket.rooms.has(socket.data.room)) return;
      targetSocket.emit(event, { sender: socket.id, user: participantInfo(socket), payload });
    });
    relay('webrtc:offer'); relay('webrtc:answer'); relay('webrtc:ice');

    socket.on('room:chat', async ({ message }, acknowledge = () => {}) => {
      try {
        const chatMode = socket.data.meetingSettings?.chatMode ?? 'EVERYONE';
        if (!socket.data.room || !socket.data.permissions?.chat || chatMode === 'CHAT_DISABLED' || (chatMode === 'HOST_ONLY' && !['host', 'interviewer'].includes(socket.data.role)) || typeof message !== 'string') throw new Error('Chat is disabled by the host.');
        const text = message.trim(); if (!text || text.length > 2000) throw new Error('Messages must be between 1 and 2,000 characters.');
        const saved = await ChatMessage.create({ meetingId: socket.data.meetingId, senderId: socket.data.user.id, message: text });
        io.to(socket.data.room).emit('room:chat', chatPayload({ ...saved.toObject(), senderId: socket.data.user })); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('room:private-message', async ({ target, message }, acknowledge = () => {}) => {
      try {
        const peers = socket.data.room ? await io.in(socket.data.room).fetchSockets() : []; const targetSocket = peers.find(peer => peer.data.user?.id === target); const text = typeof message === 'string' ? message.trim() : '';
        if (!socket.data.room || socket.data.meetingSettings?.chatMode !== 'PRIVATE_MESSAGES_ALLOWED' || !socket.data.permissions?.chat || !targetSocket || target === socket.data.user.id || !text || text.length > 2000) throw new Error('Private messaging is unavailable.');
        const saved = await ChatMessage.create({ meetingId: socket.data.meetingId, senderId: socket.data.user.id, recipientId: target, message: text }); const item = chatPayload({ ...saved.toObject(), senderId: socket.data.user });
        socket.emit('room:chat', item); targetSocket.emit('room:chat', item); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('room:chat-delete', async ({ messageId }, acknowledge = () => {}) => {
      try {
        const message = socket.data.room ? await ChatMessage.findOne({ _id: messageId, meetingId: socket.data.meetingId, deletedAt: null }) : null;
        if (!message || (!canManage(socket) && message.senderId.toString() !== socket.data.user.id)) throw new Error('You cannot delete this message.');
        message.deletedAt = new Date(); await message.save(); io.to(socket.data.room).emit('room:chat-deleted', { messageId }); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('media:state', ({ microphone, camera } = {}, acknowledge = () => {}) => {
      if (!socket.data.room || typeof microphone !== 'boolean' || typeof camera !== 'boolean') return acknowledge({ ok: false, message: 'Invalid media state.' });
      socket.data.mediaState = { microphone: microphone && socket.data.permissions?.microphone !== false, camera: camera && socket.data.permissions?.camera !== false };
      io.to(socket.data.room).emit('participant:media-state', { socketId: socket.id, userId: socket.data.user.id, ...socket.data.mediaState }); acknowledge({ ok: true });
    });

    socket.on('room:reaction', ({ emoji }, acknowledge = () => {}) => {
      if (!socket.data.room || socket.data.meetingSettings?.reactionsEnabled === false || !socket.data.permissions?.reactions || !['👍', '👏', '🎉', '❤️', '😂'].includes(emoji)) return acknowledge({ ok: false, message: 'Reactions are disabled by the host.' });
      io.to(socket.data.room).emit('room:reaction', { id: `${socket.id}-${Date.now()}`, emoji, user: socket.data.user }); acknowledge({ ok: true });
    });

    socket.on('hand:raise', (_payload = {}, acknowledge = () => {}) => {
      if (typeof acknowledge !== 'function') acknowledge = () => {};
      if (!socket.data.room || ['host', 'interviewer'].includes(socket.data.role)) return acknowledge({ ok: false, message: 'Hand raise is unavailable.' });
      const queue = raisedHands.get(socket.data.meetingId) ?? []; if (!queue.some(item => item.userId === socket.data.user.id)) queue.push({ socketId: socket.id, userId: socket.data.user.id, name: socket.data.user.name, raisedAt: new Date().toISOString() }); raisedHands.set(socket.data.meetingId, queue); io.to(socket.data.room).emit('hand:queue', queue); acknowledge({ ok: true });
    });
    socket.on('hand:lower', ({ target } = {}, acknowledge = () => {}) => {
      if (!socket.data.room) return acknowledge({ ok: false, message: 'Meeting unavailable.' });
      const requestedSocket = target ? io.sockets.sockets.get(target) : socket; if (target && !canManage(socket)) return acknowledge({ ok: false, message: 'Host permission required.' });
      const queue = (raisedHands.get(socket.data.meetingId) ?? []).filter(item => item.userId !== requestedSocket?.data.user?.id); raisedHands.set(socket.data.meetingId, queue); io.to(socket.data.room).emit('hand:queue', queue); acknowledge({ ok: true });
    });

    socket.on('whiteboard:stroke', (stroke, acknowledge = () => {}) => {
      const valid = stroke && typeof stroke === 'object' && ['pen', 'eraser'].includes(stroke.tool) && typeof stroke.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(stroke.color) && Number.isFinite(stroke.size) && stroke.size >= 1 && stroke.size <= 24 && [stroke.from, stroke.to].every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
      const required = stroke?.tool === 'eraser' ? 'EDIT' : 'DRAW';
      if (!socket.data.room || !whiteboards.has(socket.data.meetingId) || !valid || !whiteboardAllows(socket, required)) return acknowledge({ ok: false, message: 'You do not have permission to draw on this whiteboard.' });
      const strokes = whiteboards.get(socket.data.meetingId) ?? [];
      const item = { ...stroke, id: `${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
      strokes.push(item); if (strokes.length > 5000) strokes.splice(0, strokes.length - 5000);
      whiteboards.set(socket.data.meetingId, strokes);
      emitWhiteboard(socket.data.room, 'whiteboard:stroke', item);
      acknowledge({ ok: true });
    });

    socket.on('whiteboard:request-sync', () => {
      if (socket.data.room && whiteboardAllows(socket, 'VIEW')) socket.emit('whiteboard:init', { active: whiteboards.has(socket.data.meetingId), strokes: whiteboards.get(socket.data.meetingId) ?? [] });
    });

    socket.on('whiteboard:create', (acknowledge = () => {}) => {
      if (typeof acknowledge !== 'function') acknowledge = () => {};
      if (!socket.data.room || !canManage(socket)) return acknowledge({ ok: false, message: 'Only the host can create a whiteboard.' });
      if (!whiteboards.has(socket.data.meetingId)) whiteboards.set(socket.data.meetingId, []);
      emitWhiteboard(socket.data.room, 'whiteboard:created', { strokes: whiteboards.get(socket.data.meetingId) }); acknowledge({ ok: true });
    });

    socket.on('whiteboard:clear', (acknowledge = () => {}) => {
      if (typeof acknowledge !== 'function') acknowledge = () => {};
      if (!socket.data.room || !whiteboardAllows(socket, 'CLEAR')) return acknowledge({ ok: false, message: 'You do not have permission to clear the whiteboard.' });
      whiteboards.set(socket.data.meetingId, []);
      emitWhiteboard(socket.data.room, 'whiteboard:clear');
      acknowledge({ ok: true });
    });

    socket.on('participant:permissions', async ({ target, permissions }, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || !canManage(socket)) throw new Error('Host permission required.');
        const targetSocket = io.sockets.sockets.get(target); if (!targetSocket?.rooms.has(socket.data.room) || targetSocket.data.role === 'host') throw new Error('Participant is unavailable.');
        const patch = {}; const booleanKeys = ['microphone', 'camera', 'screenShare', 'chat', 'reactions', 'recording', 'files'];
        for (const key of booleanKeys) if (typeof permissions?.[key] === 'boolean') patch[key] = permissions[key];
        if (Array.isArray(permissions?.whiteboard) && permissions.whiteboard.every(value => ['VIEW', 'DRAW', 'EDIT', 'CLEAR', 'ADMIN'].includes(value))) patch.whiteboard = [...new Set(permissions.whiteboard)];
        if (!Object.keys(patch).length) throw new Error('No valid permission changes supplied.');
        const updates = Object.fromEntries(Object.entries(patch).map(([key, value]) => [`permissions.${key}`, value]));
        if ('chat' in patch) updates['permissions.canChat'] = patch.chat; if ('screenShare' in patch) updates['permissions.canShareScreen'] = patch.screenShare; if ('recording' in patch) updates['permissions.canStartRecording'] = patch.recording; if ('files' in patch) updates['permissions.canUploadFiles'] = patch.files;
        await MeetingMember.updateOne({ meetingId: socket.data.meetingId, userId: targetSocket.data.user.id }, { $set: updates });
        targetSocket.data.permissions = { ...targetSocket.data.permissions, ...patch };
        targetSocket.emit('permissions:updated', { permissions: targetSocket.data.permissions });
        io.to(socket.data.room).emit('participant:permissions-updated', { socketId: target, permissions: targetSocket.data.permissions });
        if (patch.microphone === false) targetSocket.emit('participant:command', { command: 'mute', reason: 'Microphone disabled by host.' });
        if (patch.camera === false) targetSocket.emit('participant:command', { command: 'camera-off', reason: 'Camera disabled by host.' });
        if (patch.screenShare === false && activeScreenShares.get(socket.data.meetingId)?.has(target)) targetSocket.emit('participant:command', { command: 'stop-screen-share', reason: 'Screen sharing disabled by host.' });
        acknowledge({ ok: true, permissions: targetSocket.data.permissions });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('participant:command', async ({ target, command }, acknowledge = () => {}) => {
      if (!socket.data.room || !canManage(socket)) return acknowledge({ ok: false, message: 'Host permission required.' });
      const allowed = ['mute', 'camera-off', 'request-unmute', 'request-camera', 'stop-screen-share'];
      const targetSocket = io.sockets.sockets.get(target); if (!allowed.includes(command) || !targetSocket?.rooms.has(socket.data.room) || targetSocket.data.role === 'host') return acknowledge({ ok: false, message: 'Participant or command is unavailable.' });
      targetSocket.emit('participant:command', { command, requestedBy: socket.data.user.name }); acknowledge({ ok: true });
    });

    socket.on('participant:mute-all', async (acknowledge = () => {}) => {
      if (typeof acknowledge !== 'function') acknowledge = () => {};
      if (!socket.data.room || !canManage(socket)) return acknowledge({ ok: false, message: 'Host permission required.' });
      const sockets = await io.in(socket.data.room).fetchSockets(); sockets.filter(peer => !['host', 'interviewer'].includes(peer.data.role)).forEach(peer => peer.emit('participant:command', { command: 'mute', reason: 'Muted by host.' })); acknowledge({ ok: true });
    });

    socket.on('participant:permission-all', async ({ permission, enabled }, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || socket.data.role !== 'host') throw new Error('Only the host can change permissions for everyone.');
        if (!['microphone', 'camera'].includes(permission) || typeof enabled !== 'boolean') throw new Error('Invalid permission change.');
        await MeetingMember.updateMany({ meetingId: socket.data.meetingId, role: { $nin: ['host', 'interviewer'] }, membershipStatus: 'approved' }, { $set: { [`permissions.${permission}`]: enabled } });
        const sockets = await io.in(socket.data.room).fetchSockets(); sockets.filter(peer => !['host', 'interviewer'].includes(peer.data.role)).forEach(peer => { peer.data.permissions = { ...peer.data.permissions, [permission]: enabled }; peer.emit('permissions:updated', { permissions: peer.data.permissions }); io.to(socket.data.room).emit('participant:permissions-updated', { socketId: peer.id, permissions: peer.data.permissions }); if (!enabled) peer.emit('participant:command', { command: permission === 'microphone' ? 'mute' : 'camera-off', reason: `${permission === 'microphone' ? 'Microphones' : 'Cameras'} disabled by host.` }); }); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('participant:remove', async ({ target, block = false }, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || !canManage(socket)) throw new Error('Host permission required.');
        const targetSocket = io.sockets.sockets.get(target);
        if (!targetSocket?.rooms.has(socket.data.room) || ['host', 'interviewer'].includes(targetSocket.data.role)) throw new Error('Participant is unavailable.');
        const now = new Date();
        await MeetingMember.updateOne({ meetingId: socket.data.meetingId, userId: targetSocket.data.user.id }, { $set: { membershipStatus: 'removed', participantStatus: block ? 'BANNED' : 'REMOVED', canRejoin: false, removedAt: now, bannedAt: block ? now : null } });
        targetSocket.emit('participant:removed', { blocked: block, message: block ? 'The host removed and blocked you from this meeting.' : 'The host removed you from this meeting.' });
        await leaveRoom(targetSocket, { preserveStatus: true });
        targetSocket.disconnect(true);
        acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('participant:assign-host', async ({ target }, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || socket.data.role !== 'host') throw new Error('Only a host can promote another host.');
        const targetSocket = io.sockets.sockets.get(target);
        if (!targetSocket?.rooms.has(socket.data.room) || targetSocket.id === socket.id) throw new Error('Participant is unavailable.');
        const targetMember = await MeetingMember.findOne({ meetingId: socket.data.meetingId, userId: targetSocket.data.user.id });
        if (!targetMember || targetMember.membershipStatus !== 'approved' || targetMember.participantStatus !== 'JOINED') throw new Error('Only an admitted participant in the meeting can become host.');

        await MeetingMember.updateOne(
          { meetingId: socket.data.meetingId, userId: targetSocket.data.user.id },
          { $set: { role: 'host', permissions: fullHostPermissions } }
        );

        targetSocket.data.role = 'host';
        targetSocket.data.permissions = { ...fullHostPermissions };
        targetSocket.data.isPrimaryHost = false;
        targetSocket.emit('role:updated', { role: 'host', permissions: targetSocket.data.permissions, message: 'You are now the meeting host.' });
        socket.emit('host:added', { socketId: targetSocket.id, userId: targetSocket.data.user.id, name: targetSocket.data.user.name, message: `${targetSocket.data.user.name} is now an additional host.` });
        io.to(socket.data.room).emit('participant:role-updated', { socketId: targetSocket.id, role: 'host', permissions: targetSocket.data.permissions });
        acknowledge({ ok: true, host: { socketId: targetSocket.id, userId: targetSocket.data.user.id, name: targetSocket.data.user.name } });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('participant:remove-host', async ({ target }, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || socket.data.role !== 'host' || !socket.data.isPrimaryHost) throw new Error('Only the primary host can remove another host.');
        const targetSocket = io.sockets.sockets.get(target); if (!targetSocket?.rooms.has(socket.data.room) || targetSocket.data.role !== 'host' || targetSocket.data.isPrimaryHost) throw new Error('Additional host is unavailable.');
        await MeetingMember.updateOne({ meetingId: socket.data.meetingId, userId: targetSocket.data.user.id }, { $set: { role: 'participant', permissions: defaultParticipantPermissions } });
        targetSocket.data.role = 'participant'; targetSocket.data.permissions = { ...defaultParticipantPermissions }; targetSocket.data.isPrimaryHost = false;
        targetSocket.emit('role:updated', { role: 'participant', permissions: targetSocket.data.permissions, isPrimaryHost: false, message: 'The primary host changed your role to participant.' });
        io.to(socket.data.room).emit('participant:role-updated', { socketId: targetSocket.id, role: 'participant', permissions: targetSocket.data.permissions, isPrimaryHost: false }); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('participant:transfer-primary-host', async ({ target }, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || socket.data.role !== 'host' || !socket.data.isPrimaryHost) throw new Error('Only the primary host can transfer primary ownership.');
        const targetSocket = io.sockets.sockets.get(target); if (!targetSocket?.rooms.has(socket.data.room) || targetSocket.data.role !== 'host' || targetSocket.id === socket.id) throw new Error('Choose another joined host.');
        await Meeting.updateOne({ _id: socket.data.meetingId, ownerId: socket.data.user.id }, { $set: { ownerId: targetSocket.data.user.id } });
        socket.data.isPrimaryHost = false; targetSocket.data.isPrimaryHost = true;
        socket.emit('primary-host:updated', { userId: targetSocket.data.user.id, socketId: targetSocket.id, isPrimaryHost: false, message: `${targetSocket.data.user.name} is now the primary host.` });
        targetSocket.emit('primary-host:updated', { userId: targetSocket.data.user.id, socketId: targetSocket.id, isPrimaryHost: true, message: 'You are now the primary host.' });
        io.to(socket.data.room).emit('participant:primary-host-updated', { userId: targetSocket.data.user.id, socketId: targetSocket.id }); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('participant:promote-presenter', async ({ target }, acknowledge = () => {}) => {
      try { if (!socket.data.room || !canManage(socket)) throw new Error('Host permission required.'); const targetSocket = io.sockets.sockets.get(target); if (!targetSocket?.rooms.has(socket.data.room)) throw new Error('Participant is unavailable.'); await MeetingMember.updateOne({ meetingId: socket.data.meetingId, userId: targetSocket.data.user.id }, { $set: { role: 'presenter', 'permissions.screenShare': true, 'permissions.canShareScreen': true } }); targetSocket.data.role = 'presenter'; targetSocket.data.permissions = { ...targetSocket.data.permissions, screenShare: true }; targetSocket.emit('role:updated', { role: 'presenter', permissions: targetSocket.data.permissions, message: 'The host promoted you to presenter.' }); io.to(socket.data.room).emit('participant:role-updated', { socketId: target, role: 'presenter', permissions: targetSocket.data.permissions }); acknowledge({ ok: true }); } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('screen-share:start', async (_, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || !socket.data.permissions?.screenShare) throw new Error('Screen sharing is disabled by the host.');
        const mode = socket.data.meetingSettings?.screenShareMode ?? 'HOST_AND_COHOST';
        if (mode === 'HOST_ONLY' && socket.data.role !== 'host') throw new Error('Only the host may share their screen.');
        if (mode === 'HOST_AND_COHOST' && !['host', 'interviewer', 'presenter'].includes(socket.data.role)) throw new Error('Only the host, co-host, or presenter may share their screen.');
        const active = activeScreenShares.get(socket.data.meetingId) ?? new Set(); if (socket.data.meetingSettings?.oneScreenShareAtATime !== false && active.size && !active.has(socket.id)) throw new Error('Another participant is currently sharing.');
        active.add(socket.id); activeScreenShares.set(socket.data.meetingId, active); io.to(socket.data.room).emit('screen-share:status', { socketId: socket.id, user: socket.data.user, active: true }); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });
    socket.on('screen-share:stop', () => stopScreenShare(socket));
    socket.on('screen-share:settings', async ({ screenShareMode, oneScreenShareAtATime }, acknowledge = () => {}) => {
      try {
        if (!socket.data.room || socket.data.role !== 'host') throw new Error('Only the host can change screen-sharing rules.');
        if (!['HOST_ONLY', 'HOST_AND_COHOST', 'ALL_PARTICIPANTS'].includes(screenShareMode) || typeof oneScreenShareAtATime !== 'boolean') throw new Error('Invalid screen-sharing settings.');
        await Meeting.updateOne({ _id: socket.data.meetingId }, { $set: { 'settings.screenShareMode': screenShareMode, 'settings.oneScreenShareAtATime': oneScreenShareAtATime } });
        const sockets = await io.in(socket.data.room).fetchSockets(); sockets.forEach(peer => { peer.data.meetingSettings = { ...peer.data.meetingSettings, screenShareMode, oneScreenShareAtATime }; peer.emit('screen-share:settings', { screenShareMode, oneScreenShareAtATime }); }); acknowledge({ ok: true });
      } catch (error) { acknowledge({ ok: false, message: error.message }); }
    });

    socket.on('code:join', async ({ meetingCode, problemId, language }, acknowledge = () => {}) => {
      try {
        if (!meetingCode || !['javascript', 'python', 'cpp'].includes(language)) throw new Error('Invalid collaborative editor request.');
        const meeting = await Meeting.findOne({ meetingCode, deletedAt: null, status: { $in: ['LIVE', 'PAUSED'] } }).lean();
        if (!meeting || !await MeetingMember.exists({ meetingId: meeting._id, userId: socket.data.user.id, membershipStatus: 'approved' })) throw new Error('Meeting approval is required.');
        const meetingId = meeting._id.toString();
        const problem = await Problem.findOne({ _id: problemId, meetingId }).lean();
        if (!problem || !problem.allowedLanguages.includes(language)) throw new Error('Problem or language is unavailable.');
        if (!['host', 'interviewer'].includes(socket.data.role) && !meeting.technical?.problemVisible) throw new Error('The interviewer has not revealed the problem yet.');
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

    socket.on('room:leave', async (acknowledge = () => {}) => { if (typeof acknowledge !== 'function') acknowledge = () => {}; await leaveRoom(socket, { graceful: true }); acknowledge({ ok: true }); });
    socket.on('disconnect', () => leaveRoom(socket));
  });

  async function leaveRoom(socket, { preserveStatus = false, graceful = false } = {}) {
    if (!socket.data.room) return;
    const meetingId = socket.data.meetingId;
    const room = socket.data.room;
    const wasHost = ['host', 'interviewer'].includes(socket.data.role);
    stopScreenShare(socket);
    socket.to(socket.data.room).emit('peer:left', { socketId: socket.id });
    await socket.leave(socket.data.room); delete socket.data.room; delete socket.data.meetingId;
    if (wasHost) await markHostAbsentIfNeeded(meetingId, room);
    if (!preserveStatus && meetingId && graceful) await finalizeLeave(meetingId, socket.data.user.id, room);
    if (!preserveStatus && meetingId && !graceful) {
      const key = `${meetingId}:${socket.data.user.id}`; const existing = reconnectTimers.get(key); if (existing) clearTimeout(existing);
      const timer = setTimeout(() => { reconnectTimers.delete(key); finalizeLeave(meetingId, socket.data.user.id, room).catch(() => {}); }, 30000); timer.unref?.(); reconnectTimers.set(key, timer);
      const transition = await MeetingMember.updateOne({ meetingId, userId: socket.data.user.id, participantStatus: 'JOINED' }, { $set: { participantStatus: 'RECONNECTING', reconnectingAt: new Date() } });
      if (!transition.modifiedCount) { clearTimeout(timer); reconnectTimers.delete(key); return; }
      if (reconnectTimers.get(key) !== timer) { await MeetingMember.updateOne({ meetingId, userId: socket.data.user.id, participantStatus: 'RECONNECTING' }, { $set: { participantStatus: 'JOINED', reconnectingAt: null, leftAt: null } }); return; }
      io.to(room).emit('participant:reconnecting', { userId: socket.data.user.id, name: socket.data.user.name, timeoutSec: 30 });
    }
  }
  async function finalizeLeave(meetingId, userId, room) { const sockets = await io.in(room).fetchSockets(); if (sockets.some(peer => peer.data.user?.id === userId)) return; await MeetingMember.updateOne({ meetingId, userId, participantStatus: { $nin: ['REMOVED', 'BANNED'] } }, { $set: { participantStatus: 'LEFT', reconnectingAt: null, leftAt: new Date() } }); const queue = (raisedHands.get(meetingId) ?? []).filter(item => item.userId !== userId); raisedHands.set(meetingId, queue); io.to(room).emit('hand:queue', queue); io.to(room).emit('participant:left-final', { userId }); }
  async function clearHostAbsence(meetingId, room) { const timer = hostAbsenceTimers.get(meetingId); if (timer) clearTimeout(timer); hostAbsenceTimers.delete(meetingId); const result = await Meeting.updateOne({ _id: meetingId, hostAbsentSince: { $ne: null } }, { $set: { hostAbsentSince: null } }); if (result.modifiedCount) io.to(room).emit('host:returned', { message: 'A host has returned.' }); }
  async function markHostAbsentIfNeeded(meetingId, room) {
    const sockets = await io.in(room).fetchSockets(); if (sockets.some(peer => ['host', 'interviewer'].includes(peer.data.role))) return clearHostAbsence(meetingId, room);
    const now = new Date(); const meeting = await Meeting.findOneAndUpdate({ _id: meetingId, status: { $in: ['LIVE', 'PAUSED'] }, hostAbsentSince: null }, { $set: { hostAbsentSince: now } }, { new: true }); if (!meeting) return;
    io.to(room).emit('host:absent', { graceSeconds: env.hostAbsenceGraceSeconds, message: `All hosts left. The meeting will end in ${Math.ceil(env.hostAbsenceGraceSeconds / 60)} minutes unless a host returns.` });
    const existing = hostAbsenceTimers.get(meetingId); if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => { hostAbsenceTimers.delete(meetingId); const current = await io.in(room).fetchSockets(); if (current.some(peer => ['host', 'interviewer'].includes(peer.data.role))) return clearHostAbsence(meetingId, room); const ended = await Meeting.findOneAndUpdate({ _id: meetingId, status: { $in: ['LIVE', 'PAUSED'] }, hostAbsentSince: { $ne: null } }, { $set: { status: 'ENDED', endedAt: new Date() } }, { new: true }); if (!ended) return; await MeetingMember.updateMany({ meetingId, participantStatus: { $in: ['JOINED', 'RECONNECTING'] } }, { $set: { participantStatus: 'LEFT', reconnectingAt: null, leftAt: new Date() } }); io.to(room).emit('meeting:closed', { status: 'ENDED', message: 'The meeting ended because no host returned.' }); current.forEach(peer => peer.disconnect(true)); }, env.hostAbsenceGraceSeconds * 1000); timer.unref?.(); hostAbsenceTimers.set(meetingId, timer);
  }
  function stopScreenShare(socket) {
    const active = socket.data.meetingId ? activeScreenShares.get(socket.data.meetingId) : null; if (!active?.has(socket.id)) return;
    active.delete(socket.id); if (!active.size) activeScreenShares.delete(socket.data.meetingId); if (socket.data.room) io.to(socket.data.room).emit('screen-share:status', { socketId: socket.id, user: socket.data.user, active: false });
  }
}
