import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { TechnicalWorkspace } from './TechnicalWorkspace';

function toLocalDateTimeValue(value) { const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function readDeviceSettings(meetingCode) { try { return JSON.parse(localStorage.getItem(`meeting-devices:${meetingCode}`)) ?? {}; } catch { return {}; } }
function DeviceIcon({ kind, off }) { return <svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{kind === 'mic' ? <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></> : <><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>}{off && <path d="M3 3 21 21"/>}</g></svg>; }

export function PreJoinPage() {
  const { meetingCode } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const inviteToken = new URLSearchParams(location.search).get('invite') ?? '';
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [state, setState] = useState({ loading: true });
  const [notice, setNotice] = useState('');
  const [requests, setRequests] = useState([]);
  const [previewing, setPreviewing] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [edit, setEdit] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editError, setEditError] = useState('');
  const [shareCopied, setShareCopied] = useState(false);
  const [activePanel, setActivePanel] = useState('overview');
  const [devices, setDevices] = useState(() => readDeviceSettings(meetingCode));
  const [requestsError, setRequestsError] = useState('');
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);

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

  async function loadRequests() { try { setRequests((await api.get(`/meetings/by-code/${meetingCode}/join-requests`)).data.requests); setRequestsError(''); } catch { setRequestsError('Could not load requests. Please try again.'); } }
  useEffect(() => { load(); }, [meetingCode, inviteToken]);
  useEffect(() => { const shouldPoll = state.membership?.status === 'pending' || state.membership?.participantStatus === 'REJECTED' || (state.meeting?.status === 'LIVE' && state.meeting?.settings?.allowJoinBeforeHost !== true && !state.hostPresent); if (!shouldPoll) return; const refresh = setInterval(load, 3000); return () => clearInterval(refresh); }, [meetingCode, state.membership?.status, state.membership?.participantStatus, state.meeting?.status, state.hostPresent]);
  useEffect(() => { if (!['host', 'interviewer'].includes(state.membership?.role) || state.meeting?.accessType !== 'private' || ['ENDED', 'CANCELLED', 'EXPIRED'].includes(state.meeting?.status)) return; loadRequests(); const refresh = setInterval(loadRequests, 3000); return () => clearInterval(refresh); }, [meetingCode, state.membership?.role, state.meeting?.accessType, state.meeting?.status]);
  useEffect(() => {
    let active = true;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; setPreviewing(false);
    if (devices.cameraEnabled === false) { setPermissionError(''); return; }
    setPermissionError('');
    if (!navigator.mediaDevices?.getUserMedia) { setPermissionError('Camera preview is unavailable in this browser or connection.'); return; }
    navigator.mediaDevices.getUserMedia({ video: devices.cameraId ? { deviceId: { exact: devices.cameraId } } : true, audio: false })
      .catch(error => error.name === 'OverconstrainedError' ? navigator.mediaDevices.getUserMedia({ video: true, audio: false }) : Promise.reject(error))
      .then(stream => { if (!active) return stream.getTracks().forEach(track => track.stop()); streamRef.current = stream; setPreviewing(true); })
      .catch(error => { if (active) setPermissionError(error.name === 'NotAllowedError' ? 'Camera permission denied. Enable camera access in your browser settings.' : error.name === 'NotFoundError' ? 'No camera was found.' : 'Camera preview could not be started.'); });
    return () => { active = false; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; };
  }, [meetingCode, devices.cameraEnabled, devices.cameraId]);
  function attachPreview(element) { videoRef.current = element; if (element && streamRef.current) { element.srcObject = streamRef.current; element.play().catch(() => {}); } }
  function setDevice(kind, enabled) { const next = { ...devices, [kind]: enabled }; setDevices(next); localStorage.setItem(`meeting-devices:${meetingCode}`, JSON.stringify(next)); }
  function stopPreview() { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; }
  async function join() { try { if (state.meeting.accessType === 'public') await api.post(`/meetings/by-code/${meetingCode}/join`, { inviteToken }); stopPreview(); navigate(`/rooms/${meetingCode}`); } catch (error) { setNotice(error.response?.data?.message ?? 'Could not join meeting.'); } }
  async function requestAccess() { try { setNotice((await api.post(`/meetings/by-code/${meetingCode}/request-access`, { inviteToken })).data.message); load(); } catch (error) { setNotice(error.response?.data?.message ?? 'Could not request access.'); } }
  async function save(event) { event.preventDefault(); if (edit.scheduledAt && new Date(edit.scheduledAt).getTime() <= Date.now()) return setEditError('Scheduled date and time must be in the future.'); try { await api.patch(`/meetings/by-code/${meetingCode}`, { ...edit, waitingRoomOpensMinutesBefore: Number(edit.waitingRoomOpensMinutesBefore), startAllowedMinutesBefore: Number(edit.startAllowedMinutesBefore), maxParticipants: Number(edit.maxParticipants), scheduledAt: edit.scheduledAt ? new Date(edit.scheduledAt).toISOString() : null }); setSettingsOpen(false); setEditError(''); setNotice('Meeting details saved.'); await load(); } catch (error) { setEditError(error.response?.data?.message ?? 'Could not save details.'); } }
  async function rotateInvite() { try { const { data } = await api.post(`/meetings/by-code/${meetingCode}/invite/rotate`); setState(current => ({ ...current, invitePath: data.joinPath })); await navigator.clipboard?.writeText(`${window.location.origin}${data.joinPath}`); setNotice('New invite copied. All previous invite links are now invalid.'); } catch (error) { setNotice(error.response?.data?.message ?? 'Invite link could not be regenerated.'); } }
  async function decide(id, decision) { try { await api.post(`/meetings/by-code/${meetingCode}/join-requests/${id}/decision`, { decision }); setRequests(items => items.filter(item => item.id !== id)); } catch { setNotice('Could not update request.'); } }
  async function lifecycle(action) { try { if (action === 'start') { await api.post(`/meetings/by-code/${meetingCode}/start`); stopPreview(); navigate(`/rooms/${meetingCode}`); return; } await api.post(`/meetings/by-code/${meetingCode}/close`, { action: 'cancel' }); setNotice('Meeting cancelled.'); await load(); } catch (error) { setNotice(error.response?.data?.message ?? 'Could not update meeting status.'); } }

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

  return <main className="prejoin single-screen-prejoin">
    <header className="prejoin-topbar"><Link to="/dashboard">← Back to dashboard</Link>{isHost && !terminal && <nav className="prejoin-tabs" aria-label="Meeting sections"><button type="button" className={activePanel === 'overview' ? 'active' : ''} onClick={() => setActivePanel('overview')}>Overview</button>{meeting.type === 'technical_interview' && <button type="button" className={activePanel === 'problems' ? 'active' : ''} onClick={() => setActivePanel('problems')}>Interview problems</button>}{meeting.accessType === 'private' && <button type="button" className={activePanel === 'waiting' ? 'active' : ''} onClick={() => setActivePanel('waiting')}>Waiting room{requests.length ? ` (${requests.length})` : ''}</button>}</nav>}</header>
    {notice && <div className="prejoin-toast" role="status" aria-live="polite">{notice}</div>}
    <div className="prejoin-panel" hidden={activePanel !== 'overview'}><div className="prejoin-layout"><section className="meeting-overview"><p className="eyebrow">{meeting.type === 'technical_interview' ? 'TECHNICAL INTERVIEW' : 'MEETING'}</p><h1>{meeting.title}</h1><p>{meeting.description || 'No description provided.'}</p><div className="share-link"><span>Invite link</span><div><code title={shareUrl}>{shareUrl}</code><button type="button" onClick={copyShareLink}>{shareCopied ? 'Copied' : 'Copy'}</button></div></div>{meeting.scheduledAt && <p><strong>Scheduled:</strong> {new Date(meeting.scheduledAt).toLocaleString()}</p>}<p><span className={`lifecycle-status ${meeting.status?.toLowerCase()}`}>{meeting.status}</span> {statusText}</p><section className="prejoin-card"><p>{lobbyMessage}</p>{meetingAction}</section>{isHost && edit && !terminal && <div className="prejoin-host-actions">{['SCHEDULED', 'WAITING_TO_START'].includes(meeting.status) && <button className="secondary" onClick={() => { setEditError(''); setSettingsOpen(true); }}>Update meeting details</button>}{membership?.isPrimaryHost && <button className="secondary" onClick={rotateInvite}>Regenerate invite</button>}{['SCHEDULED', 'WAITING_TO_START'].includes(meeting.status) && <button className="reject" onClick={() => lifecycle('cancel')}>Cancel meeting</button>}</div>}</section><section className="device-card"><div className="video-preview">{previewing && devices.cameraEnabled !== false ? <video ref={attachPreview} autoPlay muted playsInline /> : <div className="video-placeholder">{devices.cameraEnabled === false ? 'Camera is off' : permissionError ? 'Camera preview unavailable' : 'Starting camera preview…'}</div>}<div className="preview-media-controls"><button type="button" className={devices.cameraEnabled === false ? 'media-off' : ''} aria-label={devices.cameraEnabled === false ? 'Turn camera on' : 'Turn camera off'} aria-pressed={devices.cameraEnabled !== false} title={devices.cameraEnabled === false ? 'Turn camera on' : 'Turn camera off'} onClick={() => setDevice('cameraEnabled', devices.cameraEnabled === false)}><DeviceIcon kind="camera" off={devices.cameraEnabled === false} /></button><button type="button" className={devices.microphoneEnabled === false ? 'media-off' : ''} aria-label={devices.microphoneEnabled === false ? 'Turn microphone on' : 'Turn microphone off'} aria-pressed={devices.microphoneEnabled !== false} title={devices.microphoneEnabled === false ? 'Turn microphone on' : 'Turn microphone off'} onClick={() => setDevice('microphoneEnabled', devices.microphoneEnabled === false)}><DeviceIcon kind="mic" off={devices.microphoneEnabled === false} /></button></div></div>{permissionError && devices.cameraEnabled !== false && <p className="error">{permissionError}</p>}<p className="preview-note">Your camera and microphone choices will be used when you join.</p></section></div></div>
    {isHost && !terminal && activePanel === 'problems' && meeting.type === 'technical_interview' && <div className="prejoin-panel scroll-panel"><TechnicalWorkspace meetingCode={meetingCode} canManage problemVisible={meeting.technical?.problemVisible} technical={meeting.technical} /></div>}
    {isHost && !terminal && activePanel === 'waiting' && meeting.accessType === 'private' && <div className="prejoin-panel scroll-panel"><section className="host-requests"><div><h2>Waiting room</h2><button className="secondary" onClick={loadRequests}>Refresh requests</button></div>{requestsError && <p className="error">{requestsError}</p>}{requests.length === 0 && !requestsError && <p>No participants are waiting.</p>}{requests.map(request => <div className="request-row" key={request.id}><span><strong>{request.user.name}</strong><small>{request.user.email}</small></span><span><button onClick={() => decide(request.id, 'approved')}>Admit</button><button className="reject" onClick={() => decide(request.id, 'rejected')}>Reject 30s</button><button className="reject" onClick={() => decide(request.id, 'blocked')}>Block</button></span></div>)}</section></div>}
    {isHost && settingsOpen && edit && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><form className="modal meeting-details-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-details-title" onSubmit={save}><div className="modal-title"><h2 id="meeting-details-title">Update meeting details</h2><button type="button" className="icon-button" aria-label="Close meeting details" onClick={() => setSettingsOpen(false)}>×</button></div><label>Title<input required minLength="3" value={edit.title} onChange={event => setEdit({ ...edit, title: event.target.value })} /></label><label>Description<textarea value={edit.description} onChange={event => setEdit({ ...edit, description: event.target.value })} /></label><label>Access<select value={edit.accessType} onChange={event => setEdit({ ...edit, accessType: event.target.value })}><option value="private">Private</option><option value="public">Public</option></select></label><label>Schedule<input type="datetime-local" value={edit.scheduledAt} onChange={event => setEdit({ ...edit, scheduledAt: event.target.value })} /></label><label>Waiting room opens (minutes before)<input type="number" min="0" max="10080" value={edit.waitingRoomOpensMinutesBefore} onChange={event => setEdit({ ...edit, waitingRoomOpensMinutesBefore: event.target.value })} /></label><label>Host may start (minutes before)<input type="number" min="0" max="1440" value={edit.startAllowedMinutesBefore} onChange={event => setEdit({ ...edit, startAllowedMinutesBefore: event.target.value })} /></label><label>Maximum participants<input type="number" min="2" max="100" value={edit.maxParticipants} onChange={event => setEdit({ ...edit, maxParticipants: event.target.value })} /></label><label className="meeting-details-toggle"><input type="checkbox" checked={edit.allowJoinBeforeHost} onChange={event => setEdit({ ...edit, allowJoinBeforeHost: event.target.checked })} /> Allow participants to join before host</label>{editError && <p className="error">{editError}</p>}<div className="meeting-details-actions"><button type="button" className="secondary" onClick={() => setSettingsOpen(false)}>Cancel</button><button type="submit">Save changes</button></div></form></div>}
  </main>;
}
