import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { TechnicalWorkspace } from './TechnicalWorkspace';

function toLocalDateTimeValue(value) { const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }

export function PreJoinPage() {
  const { meetingCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const inviteToken = new URLSearchParams(location.search).get('invite') ?? '';
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const levelFrameRef = useRef(null);
  const [state, setState] = useState({ loading: true });
  const [notice, setNotice] = useState('');
  const [requests, setRequests] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [devices, setDevices] = useState({ cameras: [], microphones: [], speakers: [] });
  const [deviceSettings, setDeviceSettings] = useState(() => { try { return JSON.parse(localStorage.getItem(`meeting-devices:${meetingCode}`)) ?? { cameraEnabled: true, microphoneEnabled: true, cameraId: '', microphoneId: '', speakerId: '' }; } catch { return { cameraEnabled: true, microphoneEnabled: true, cameraId: '', microphoneId: '', speakerId: '' }; } });
  const [micLevel, setMicLevel] = useState(0);
  const [permissionError, setPermissionError] = useState('');
  const [edit, setEdit] = useState(null);
  const [shareCopied, setShareCopied] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/meetings/by-code/${meetingCode}`, { params: inviteToken ? { invite: inviteToken } : {} });
      setState({ loading: false, ...data });
      setEdit({
        title: data.meeting.title, description: data.meeting.description || '', accessType: data.meeting.accessType,
        scheduledAt: data.meeting.scheduledAt ? toLocalDateTimeValue(data.meeting.scheduledAt) : '',
        allowJoinBeforeHost: data.meeting.settings?.allowJoinBeforeHost === true,
        waitingRoomOpensMinutesBefore: data.meeting.settings?.waitingRoomOpensMinutesBefore ?? 15,
        startAllowedMinutesBefore: data.meeting.settings?.startAllowedMinutesBefore ?? 0,
        maxParticipants: data.meeting.settings?.maxParticipants ?? 100
      });
    } catch (error) { setState({ loading: false, error: error.response?.data?.message ?? 'Could not load meeting.' }); }
  };

  async function loadRequests() { try { setRequests((await api.get(`/meetings/by-code/${meetingCode}/join-requests`)).data.requests); } catch { setNotice('Could not load requests.'); } }
  useEffect(() => { load(); return () => { streamRef.current?.getTracks().forEach(track => track.stop()); if (levelFrameRef.current) cancelAnimationFrame(levelFrameRef.current); audioContextRef.current?.close(); }; }, [meetingCode, inviteToken]);
  useEffect(() => { const shouldPoll = state.membership?.status === 'pending' || state.membership?.participantStatus === 'REJECTED' || (state.meeting?.status === 'LIVE' && state.meeting?.settings?.allowJoinBeforeHost !== true && !state.hostPresent); if (!shouldPoll) return; const refresh = setInterval(load, 3000); return () => clearInterval(refresh); }, [meetingCode, state.membership?.status, state.membership?.participantStatus, state.meeting?.status, state.hostPresent]);
  useEffect(() => { if (!['host', 'interviewer'].includes(state.membership?.role) || state.meeting?.accessType !== 'private' || ['ENDED', 'CANCELLED', 'EXPIRED'].includes(state.meeting?.status)) return; loadRequests(); const refresh = setInterval(loadRequests, 3000); return () => clearInterval(refresh); }, [meetingCode, state.membership?.role, state.meeting?.accessType, state.meeting?.status]);
  useEffect(() => { if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current; }, [previewing]);

  async function preview() {
    setPermissionError(''); streamRef.current?.getTracks().forEach(track => track.stop()); if (levelFrameRef.current) cancelAnimationFrame(levelFrameRef.current);
    try {
      const constraints = { video: deviceSettings.cameraEnabled ? (deviceSettings.cameraId ? { deviceId: { exact: deviceSettings.cameraId } } : true) : false, audio: deviceSettings.microphoneEnabled ? (deviceSettings.microphoneId ? { deviceId: { exact: deviceSettings.microphoneId } } : true) : false };
      if (!constraints.video && !constraints.audio) { setPreviewing(false); setNotice('Camera and microphone are both turned off.'); return; }
      const stream = await navigator.mediaDevices.getUserMedia(constraints); streamRef.current = stream; setPreviewing(true);
      const available = await navigator.mediaDevices.enumerateDevices(); setDevices({ cameras: available.filter(item => item.kind === 'videoinput'), microphones: available.filter(item => item.kind === 'audioinput'), speakers: available.filter(item => item.kind === 'audiooutput') });
      if (deviceSettings.microphoneEnabled && stream.getAudioTracks().length) { const context = new AudioContext(); audioContextRef.current?.close(); audioContextRef.current = context; const analyser = context.createAnalyser(); analyser.fftSize = 256; context.createMediaStreamSource(stream).connect(analyser); const data = new Uint8Array(analyser.frequencyBinCount); const update = () => { analyser.getByteFrequencyData(data); setMicLevel(Math.min(100, Math.round(data.reduce((sum, value) => sum + value, 0) / data.length))); levelFrameRef.current = requestAnimationFrame(update); }; update(); } else setMicLevel(0);
      setNotice('Device check ready.');
    } catch (error) { setPreviewing(false); setMicLevel(0); const message = error.name === 'NotAllowedError' ? 'Camera or microphone permission denied. Enable access in your browser settings, then try again.' : error.name === 'NotFoundError' ? 'The selected camera or microphone was not found. Choose another device.' : 'Camera or microphone could not be started. Check whether another application is using the device.'; setPermissionError(message); setNotice(''); }
  }
  async function join() { try { localStorage.setItem(`meeting-devices:${meetingCode}`, JSON.stringify(deviceSettings)); streamRef.current?.getTracks().forEach(track => track.stop()); if (state.meeting.accessType === 'public') await api.post(`/meetings/by-code/${meetingCode}/join`, { inviteToken }); navigate(`/rooms/${meetingCode}`); } catch (error) { setNotice(error.response?.data?.message ?? 'Could not join meeting.'); } }
  async function requestAccess() { try { setNotice((await api.post(`/meetings/by-code/${meetingCode}/request-access`, { inviteToken })).data.message); load(); } catch (error) { setNotice(error.response?.data?.message ?? 'Could not request access.'); } }
  async function save(event) { event.preventDefault(); if (edit.scheduledAt && new Date(edit.scheduledAt).getTime() <= Date.now()) return setNotice('Scheduled date and time must be in the future.'); try { await api.patch(`/meetings/by-code/${meetingCode}`, { ...edit, waitingRoomOpensMinutesBefore: Number(edit.waitingRoomOpensMinutesBefore), startAllowedMinutesBefore: Number(edit.startAllowedMinutesBefore), maxParticipants: Number(edit.maxParticipants), scheduledAt: edit.scheduledAt ? new Date(edit.scheduledAt).toISOString() : null }); setNotice('Meeting details saved.'); load(); } catch (error) { setNotice(error.response?.data?.message ?? 'Could not save details.'); } }
  async function rotateInvite() { try { const { data } = await api.post(`/meetings/by-code/${meetingCode}/invite/rotate`); setState(current => ({ ...current, invitePath: data.joinPath })); await navigator.clipboard?.writeText(`${window.location.origin}${data.joinPath}`); setNotice('New invite copied. All previous invite links are now invalid.'); } catch (error) { setNotice(error.response?.data?.message ?? 'Invite link could not be regenerated.'); } }
  async function decide(id, decision) { try { await api.post(`/meetings/by-code/${meetingCode}/join-requests/${id}/decision`, { decision }); setRequests(items => items.filter(item => item.id !== id)); } catch { setNotice('Could not update request.'); } }
  async function lifecycle(action) { try { if (action === 'start') { await api.post(`/meetings/by-code/${meetingCode}/start`); await load(); navigate(`/rooms/${meetingCode}`); return; } await api.post(`/meetings/by-code/${meetingCode}/close`, { action: 'cancel' }); setNotice('Meeting cancelled.'); await load(); } catch (error) { setNotice(error.response?.data?.message ?? 'Could not update meeting status.'); } }

  if (state.loading) return <main className="loading">Loading meeting...</main>;
  if (state.error) return <main className="prejoin"><Link to="/dashboard">← Back</Link><h1>{state.error}</h1></main>;
  const { meeting, membership } = state;
  const isHost = ['host', 'interviewer'].includes(membership?.role);
  const terminal = ['ENDED', 'CANCELLED', 'EXPIRED'].includes(meeting.status);
  const isLive = meeting.status === 'LIVE';
  const hostGateOpen = isHost || meeting.settings?.allowJoinBeforeHost === true || state.hostPresent;
  const canJoin = isLive && hostGateOpen && (!meeting.locked || isHost) && !['REMOVED', 'BANNED'].includes(membership?.participantStatus) && (meeting.accessType === 'public' || membership?.status === 'approved');
  const cooldownSeconds = membership?.rejectedUntil ? Math.max(0, Math.ceil((new Date(membership.rejectedUntil).getTime() - Date.now()) / 1000)) : 0;
  const statusText = { SCHEDULED: 'Meeting has not started yet', WAITING_TO_START: 'Waiting for the host to start this meeting', LIVE: 'This meeting is live', PAUSED: 'This meeting is paused', ENDED: 'This meeting has ended', CANCELLED: 'This meeting was cancelled', EXPIRED: 'This meeting expired' }[meeting.status] ?? meeting.status;
  const shareUrl = state.invitePath ? `${window.location.origin}${state.invitePath}` : window.location.href;
  const copyShareLink = async () => { await navigator.clipboard?.writeText(shareUrl); setShareCopied(true); setTimeout(() => setShareCopied(false), 1800); };
  const lobbyMessage = state.scheduleInvalid ? 'This meeting was scheduled for a past date. The host must select a future date before anyone can join.' : terminal ? statusText : meeting.locked && !isHost ? 'The host has locked this meeting.' : !state.waitingRoomOpen && !isHost ? `The waiting room opens ${meeting.settings?.waitingRoomOpensMinutesBefore ?? 15} minutes before the scheduled time.` : membership?.participantStatus === 'BANNED' ? 'The host blocked you from this meeting.' : membership?.participantStatus === 'REMOVED' ? 'The host removed you and rejoining is disabled.' : membership?.status === 'pending' ? 'You are in the waiting room. The host must admit you before you can enter.' : membership?.participantStatus === 'REJECTED' && cooldownSeconds > 0 ? `Request rejected. You may request again in ${cooldownSeconds} seconds.` : isLive && !hostGateOpen ? 'Waiting for host to join the meeting.' : canJoin ? 'You are ready to join.' : isLive ? 'Request host approval to enter this private meeting.' : 'This meeting is not open for entry yet.';
  let meetingAction = null;
  if (state.scheduleInvalid) meetingAction = <button disabled>Correct the scheduled date</button>;
  else if (isHost && ['SCHEDULED', 'WAITING_TO_START'].includes(meeting.status)) meetingAction = <button onClick={() => lifecycle('start')}>Start meeting</button>;
  else if (canJoin) meetingAction = <button onClick={join}>Join meeting room</button>;
  else if (!isHost && !terminal) {
    if (['REMOVED', 'BANNED'].includes(membership?.participantStatus)) meetingAction = <button disabled>Joining unavailable</button>;
    else if (meeting.locked) meetingAction = <button disabled>Meeting locked by host</button>;
    else if (!state.waitingRoomOpen) meetingAction = <button disabled>Waiting room not open yet</button>;
    else if (meeting.accessType === 'private' && membership?.status === 'pending') meetingAction = <button disabled>Request pending</button>;
    else if (meeting.accessType === 'private' && cooldownSeconds > 0) meetingAction = <button disabled>Retry in {cooldownSeconds}s</button>;
    else if (meeting.accessType === 'private' && membership?.status !== 'approved') meetingAction = <button onClick={requestAccess}>Request access</button>;
    else if (!isLive) meetingAction = <button disabled>Waiting for host to start</button>;
    else if (!hostGateOpen) meetingAction = <button disabled>Waiting for host to join</button>;
    else meetingAction = <button onClick={join}>Join meeting room</button>;
  }

  return <main className="prejoin">
    <Link to="/dashboard">← Back to dashboard</Link>
    <div className="prejoin-layout"><section className="meeting-overview"><p className="eyebrow">{meeting.type === 'technical_interview' ? 'TECHNICAL INTERVIEW' : 'MEETING'}</p><h1>{meeting.title}</h1><p>{meeting.description || 'No description provided.'}</p><div className="share-link"><span>Invite link</span><div><code title={shareUrl}>{shareUrl}</code><button type="button" onClick={copyShareLink}>{shareCopied ? 'Copied' : 'Copy'}</button></div></div>{meeting.scheduledAt && <p><strong>Scheduled:</strong> {new Date(meeting.scheduledAt).toLocaleString()}</p>}<p><span className={`lifecycle-status ${meeting.status?.toLowerCase()}`}>{meeting.status}</span> {statusText}</p><section className="prejoin-card"><p>{lobbyMessage}</p>{meetingAction}{notice && <p className="notice">{notice}</p>}</section></section><section className="device-card"><div className="video-preview">{previewing && deviceSettings.cameraEnabled ? <video ref={videoRef} autoPlay muted playsInline /> : <div className="video-placeholder">Camera preview is off</div>}</div><div className="device-toggles"><label><input type="checkbox" checked={deviceSettings.cameraEnabled} onChange={event => setDeviceSettings(current => ({ ...current, cameraEnabled: event.target.checked }))} /> Camera</label><label><input type="checkbox" checked={deviceSettings.microphoneEnabled} onChange={event => setDeviceSettings(current => ({ ...current, microphoneEnabled: event.target.checked }))} /> Microphone</label></div><label>Camera<select value={deviceSettings.cameraId} onChange={event => setDeviceSettings(current => ({ ...current, cameraId: event.target.value }))}><option value="">System default</option>{devices.cameras.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Camera'}</option>)}</select></label><label>Microphone<select value={deviceSettings.microphoneId} onChange={event => setDeviceSettings(current => ({ ...current, microphoneId: event.target.value }))}><option value="">System default</option>{devices.microphones.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}</select></label><label>Speaker<select value={deviceSettings.speakerId} disabled={!('setSinkId' in HTMLMediaElement.prototype)} onChange={event => setDeviceSettings(current => ({ ...current, speakerId: event.target.value }))}><option value="">System default</option>{devices.speakers.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Speaker'}</option>)}</select></label><label>Microphone level<progress max="100" value={micLevel} /></label><button className="secondary" onClick={preview}>Test selected devices</button>{permissionError && <p className="error">{permissionError}</p>}</section></div>
    {isHost && edit && !terminal && <>
      <section className="host-requests"><div><h2>Host lobby {membership?.isPrimaryHost && <small>Primary host</small>}</h2><span>{membership?.isPrimaryHost && <button className="secondary" onClick={rotateInvite}>Regenerate invite</button>}{['SCHEDULED', 'WAITING_TO_START'].includes(meeting.status) && <button className="reject" onClick={() => lifecycle('cancel')}>Cancel meeting</button>}</span></div><p>{meeting.status === 'SCHEDULED' ? 'The start button follows the configured early-start window.' : meeting.status === 'WAITING_TO_START' ? 'You may start the meeting when ready.' : 'Participants can enter while the meeting is live.'}</p></section>
      <section className="host-requests"><h2>Meeting settings</h2><form onSubmit={save}><label>Title<input value={edit.title} onChange={event => setEdit({ ...edit, title: event.target.value })} /></label><label>Description<textarea value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })} /></label><label>Access<select value={edit.accessType} onChange={event => setEdit({ ...edit, accessType: event.target.value })}><option value="private">Private</option><option value="public">Public</option></select></label><label>Schedule<input type="datetime-local" value={edit.scheduledAt} onChange={event => setEdit({ ...edit, scheduledAt: event.target.value })} /></label><label>Waiting room opens (minutes before)<input type="number" min="0" max="10080" value={edit.waitingRoomOpensMinutesBefore} onChange={event => setEdit({ ...edit, waitingRoomOpensMinutesBefore: event.target.value })} /></label><label>Host may start (minutes before)<input type="number" min="0" max="1440" value={edit.startAllowedMinutesBefore} onChange={event => setEdit({ ...edit, startAllowedMinutesBefore: event.target.value })} /></label><label>Maximum participants<input type="number" min="2" max="100" value={edit.maxParticipants} onChange={event => setEdit({ ...edit, maxParticipants: event.target.value })} /></label><label><input type="checkbox" checked={edit.allowJoinBeforeHost} onChange={event => setEdit({ ...edit, allowJoinBeforeHost: event.target.checked })} /> Allow participants to join before host</label><button>Save changes</button></form></section>
      {meeting.type === 'technical_interview' && <TechnicalWorkspace meetingCode={meetingCode} canManage problemVisible={meeting.technical?.problemVisible} technical={meeting.technical} />}
      <section className="host-requests"><div><h2>Waiting room</h2><button className="secondary" onClick={loadRequests}>Refresh requests</button></div>{requests.map(request => <div className="request-row" key={request.id}><span><strong>{request.user.name}</strong><small>{request.user.email}</small></span><span><button onClick={() => decide(request.id, 'approved')}>Admit</button><button className="reject" onClick={() => decide(request.id, 'rejected')}>Reject 30s</button><button className="reject" onClick={() => decide(request.id, 'blocked')}>Block</button></span></div>)}</section>
    </>}
  </main>;
}
