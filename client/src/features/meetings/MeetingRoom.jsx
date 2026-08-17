import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { TechnicalWorkspace } from './TechnicalWorkspace';

const rtcConfig = { iceServers: [{ urls: import.meta.env.VITE_STUN_URL ?? 'stun:stun.l.google.com:19302' }, ...(import.meta.env.VITE_TURN_URL ? [{ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : [])] };
function VideoTile({ stream, name, muted = false }) { const ref = useRef(null); useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]); return <article className="video-tile"><video ref={ref} autoPlay playsInline muted={muted} /><span>{name}</span></article>; }

export function MeetingRoom() {
  const { meetingCode } = useParams(); const navigate = useNavigate(); const { user, accessToken } = useAuth(); const [meeting, setMeeting] = useState(null); const [membership, setMembership] = useState(null); const [status, setStatus] = useState('Connecting to the meeting...'); const [localStream, setLocalStream] = useState(null); const [peers, setPeers] = useState({}); const [cameraOn, setCameraOn] = useState(true); const [micOn, setMicOn] = useState(true); const [sharingScreen, setSharingScreen] = useState(false); const [messages, setMessages] = useState([]); const [chatText, setChatText] = useState('');
  const socketRef = useRef(null); const connectionsRef = useRef(new Map()); const localStreamRef = useRef(null); const screenStreamRef = useRef(null);
  useEffect(() => {
    let active = true;
    async function connect() {
      try {
        const { data } = await api.get(`/meetings/by-code/${meetingCode}`); if (!active) return; setMeeting(data.meeting); setMembership(data.membership);
        let stream = null; try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch { setStatus('Joined without camera or microphone. Enable them in browser settings to share media.'); }
        if (!active) { stream?.getTracks().forEach(track => track.stop()); return; } localStreamRef.current = stream; setLocalStream(stream);
        const socket = io(import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:5000', { auth: { token: accessToken }, transports: ['websocket'] }); socketRef.current = socket;
        const closePeer = (socketId) => { connectionsRef.current.get(socketId)?.close(); connectionsRef.current.delete(socketId); setPeers(current => { const next = { ...current }; delete next[socketId]; return next; }); };
        const makeConnection = (socketId, peerUser) => {
          if (connectionsRef.current.has(socketId)) return connectionsRef.current.get(socketId);
          const connection = new RTCPeerConnection(rtcConfig); connectionsRef.current.set(socketId, connection);
          localStreamRef.current?.getTracks().forEach(track => connection.addTrack(track, localStreamRef.current));
          connection.onicecandidate = ({ candidate }) => { if (candidate) socket.emit('webrtc:ice', { target: socketId, payload: candidate }); };
          connection.ontrack = ({ streams }) => setPeers(current => ({ ...current, [socketId]: { user: peerUser, stream: streams[0] } }));
          connection.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(connection.connectionState)) closePeer(socketId); };
          return connection;
        };
        const offer = async (socketId, peerUser) => { const connection = makeConnection(socketId, peerUser); const description = await connection.createOffer(); await connection.setLocalDescription(description); socket.emit('webrtc:offer', { target: socketId, payload: connection.localDescription }); };
        socket.on('connect', () => socket.emit('room:join', { meetingCode }, async (result) => { if (!result?.ok) { setStatus(result?.message ?? 'Could not join this meeting.'); socket.disconnect(); return; } setStatus('Connected'); }));
        socket.on('room:peers', (currentPeers) => currentPeers.forEach(peer => offer(peer.socketId, peer.user).catch(() => setStatus('A peer connection could not be created.'))));
        socket.on('peer:joined', (peer) => offer(peer.socketId, peer.user).catch(() => setStatus('A peer connection could not be created.')));
        socket.on('webrtc:offer', async ({ sender, user: peerUser, payload }) => { const connection = makeConnection(sender, peerUser ?? { name: 'Participant' }); await connection.setRemoteDescription(payload); const answer = await connection.createAnswer(); await connection.setLocalDescription(answer); socket.emit('webrtc:answer', { target: sender, payload: connection.localDescription }); });
        socket.on('webrtc:answer', async ({ sender, payload }) => { const connection = connectionsRef.current.get(sender); if (connection) await connection.setRemoteDescription(payload); });
        socket.on('webrtc:ice', async ({ sender, payload }) => { const connection = connectionsRef.current.get(sender); if (connection) await connection.addIceCandidate(payload); });
        socket.on('peer:left', ({ socketId }) => closePeer(socketId));
        socket.on('room:chat', (message) => setMessages(current => [...current.slice(-99), message]));
        socket.on('connect_error', () => setStatus('Realtime connection failed. Please refresh and try again.'));
      } catch (error) { setStatus(error.response?.data?.message ?? 'Could not load this meeting.'); }
    }
    connect();
    return () => { socketRef.current?.emit('room:leave'); socketRef.current?.disconnect(); connectionsRef.current.forEach(connection => connection.close()); connectionsRef.current.clear(); screenStreamRef.current?.getTracks().forEach(track => track.stop()); localStreamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [accessToken, meetingCode]);
  function toggle(kind) { const enabled = kind === 'video' ? !cameraOn : !micOn; localStreamRef.current?.getTracks().filter(track => track.kind === kind).forEach(track => { track.enabled = enabled; }); if (kind === 'video') setCameraOn(enabled); else setMicOn(enabled); }
  async function stopScreenShare() { const cameraTrack = localStreamRef.current?.getVideoTracks()[0]; if (cameraTrack) connectionsRef.current.forEach(connection => connection.getSenders().find(sender => sender.track?.kind === 'video')?.replaceTrack(cameraTrack)); screenStreamRef.current?.getTracks().forEach(track => track.stop()); screenStreamRef.current = null; setSharingScreen(false); }
  async function toggleScreenShare() { try { if (sharingScreen) return stopScreenShare(); const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); const track = stream.getVideoTracks()[0]; if (!track) return; screenStreamRef.current = stream; connectionsRef.current.forEach(connection => connection.getSenders().find(sender => sender.track?.kind === 'video')?.replaceTrack(track)); track.onended = stopScreenShare; setSharingScreen(true); } catch { setStatus('Screen sharing was not started.'); } }
  function sendChat(event) { event.preventDefault(); const message = chatText.trim(); if (!message) return; socketRef.current?.emit('room:chat', { message }, (result) => { if (!result?.ok) setStatus(result?.message ?? 'Message could not be sent.'); }); setChatText(''); }
  function leave() { navigate(`/meetings/${meetingCode}`); }
  return <main className="room"><header className="room-header"><div><p className="eyebrow">LIVE {meeting?.type === 'technical_interview' ? 'TECHNICAL INTERVIEW' : 'MEETING'}</p><h1>{meeting?.title ?? 'Meeting room'}</h1></div><span className="connection-status">● {status}</span></header><div className="room-layout"><section className="video-grid">{localStream ? <VideoTile stream={localStream} name={`${user?.name ?? 'You'} (you)`} muted /> : <article className="video-tile empty-video"><span>Camera unavailable</span><small>You are still connected to the room.</small></article>}{Object.entries(peers).map(([id, peer]) => <VideoTile key={id} stream={peer.stream} name={peer.user?.name ?? 'Participant'} />)}</section><aside className="room-chat"><h2>In-room chat</h2><div className="chat-messages">{messages.length ? messages.map(item => <p key={item.id}><strong>{item.user?.name ?? 'Participant'}</strong>{item.message}</p>) : <span>Messages stay in this meeting room.</span>}</div><form onSubmit={sendChat}><input aria-label="Message" maxLength="2000" value={chatText} onChange={event => setChatText(event.target.value)} placeholder="Write a message" /><button>Send</button></form></aside></div>{meeting?.type === 'technical_interview' && <TechnicalWorkspace meetingCode={meetingCode} canManage={membership?.role === 'host' || membership?.role === 'interviewer'} />}<footer className="room-controls"><button className="secondary" onClick={() => toggle('audio')}>{micOn ? 'Mute microphone' : 'Unmute microphone'}</button><button className="secondary" onClick={() => toggle('video')}>{cameraOn ? 'Turn camera off' : 'Turn camera on'}</button><button className="secondary" onClick={toggleScreenShare}>{sharingScreen ? 'Stop sharing' : 'Share screen'}</button><button className="leave-button" onClick={leave}>Leave meeting</button></footer></main>;
}
