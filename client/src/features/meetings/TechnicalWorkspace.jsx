import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../../lib/api';

const template = {
  javascript: '// Write your solution here\n',
  python: '# Write your solution here\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  // Write your solution here\n  return 0;\n}\n'
};
const blank = { title: '', statement: '', timeLimitSec: 1800, sampleInput: '', sampleOutput: '', hiddenInput: '', hiddenOutput: '' };

export function TechnicalWorkspace({ meetingCode, canManage, socket, candidates = [], currentUserId, problemVisible = false, onStartCoding, technical = {} }) {
  const [problems, setProblems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [problem, setProblem] = useState(null);
  const [tests, setTests] = useState([]);
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState(template.javascript);
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [execution, setExecution] = useState(null);
  const [running, setRunning] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [startedAt, setStartedAt] = useState(technical.candidateStartedAt);
  const [now, setNow] = useState(Date.now());
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Connecting editor…');
  const [roundReady, setRoundReady] = useState(Boolean(technical.ready));
  const [codingAccess, setCodingAccess] = useState(Boolean(technical.codingAccess));
  const [assignedCandidateId, setAssignedCandidateId] = useState(technical.candidateId ? String(technical.candidateId) : '');
  const skipRef = useRef(false);
  const typingRef = useRef(false);

  const candidateId = canManage ? selectedCandidateId : currentUserId;
  const isSelectedCandidate = !canManage && assignedCandidateId === currentUserId;
  const secondsLeft = startedAt && technical.durationSec ? Math.max(0, technical.durationSec - Math.floor((now - new Date(startedAt).getTime()) / 1000)) : null;

  const load = async () => {
    try {
      const { data } = await api.get(`/interviews/${meetingCode}/problems`);
      setProblems(data.problems);
      setSelected(current => current ?? data.problems[0]?.id ?? null);
    } catch (error) {
      setNotice(error.response?.data?.message ?? 'Could not load coding problem.');
    }
  };

  useEffect(() => { load(); }, [meetingCode, problemVisible]);
  useEffect(() => {
    if (!selected) { setProblem(null); setTests([]); return; }
    api.get(`/interviews/${meetingCode}/problems/${selected}`).then(({ data }) => {
      const initialLanguage = data.problem.allowedLanguages[0];
      setProblem(data.problem);
      setTests(data.testCases);
      setLanguage(initialLanguage);
      setDraftReady(false);
      setCode(template[initialLanguage] ?? '');
      setExecution(null);
    }).catch(error => setNotice(error.response?.data?.message ?? 'Could not load problem.'));
  }, [meetingCode, selected]);
  useEffect(() => {
    if (!canManage) return;
    setSelectedCandidateId(current => candidates.some(item => item.id === current) ? current : candidates[0]?.id ?? '');
  }, [canManage, candidates]);
  useEffect(() => {
    if (!socket || !selected || !candidateId) { setDraftReady(false); if (canManage) setLiveStatus('Waiting for a candidate'); return undefined; }
    setDraftReady(false);
    setLiveStatus('Loading draft…');
    socket.emit('code:join', { meetingCode, problemId: selected, language, candidateId }, result => {
      if (!result?.ok) { setNotice(result?.message ?? 'Could not open the live draft.'); setLiveStatus('Editor unavailable'); return; }
      skipRef.current = true;
      setCode(result.found ? result.sourceCode : template[language] ?? '');
      setDraftReady(true);
      setLiveStatus(canManage ? `Watching ${result.candidate?.name ?? 'candidate'}` : result.found ? 'Draft recovered' : 'Draft ready');
    });
    const update = ({ problemId, language: incoming, candidateId: incomingCandidate, sourceCode }) => {
      if (problemId === selected && incoming === language && incomingCandidate === candidateId) { skipRef.current = true; setCode(sourceCode); if (canManage) setLiveStatus('Candidate is editing'); }
    };
    const typing = ({ candidateId: incomingCandidate, typing: active, user }) => {
      if (incomingCandidate === candidateId && canManage) setLiveStatus(active ? `${user?.name ?? 'Candidate'} is typing…` : `Watching ${user?.name ?? 'candidate'}`);
    };
    const activity = ({ candidateId: incomingCandidate, status, summary }) => {
      if (incomingCandidate !== candidateId) return;
      const labels = { RUNNING: 'Running sample tests…', SUBMITTING: 'Submitting solution…', FAILED: 'Execution failed', RUN_COMPLETE: `Run complete · ${summary?.passed ?? 0}/${summary?.total ?? 0} passed`, SUBMITTED: `Submitted · ${summary?.passed ?? 0}/${summary?.total ?? 0} passed` };
      setLiveStatus(labels[status] ?? status);
    };
    socket.on('code:update', update);
    socket.on('code:typing', typing);
    socket.on('code:activity', activity);
    return () => { socket.off('code:update', update); socket.off('code:typing', typing); socket.off('code:activity', activity); };
  }, [socket, meetingCode, selected, language, candidateId, canManage]);
  useEffect(() => {
    if (!socket || !selected || !candidateId || !draftReady || canManage || !startedAt || !codingAccess) return undefined;
    if (skipRef.current) { skipRef.current = false; return undefined; }
    if (!typingRef.current) { typingRef.current = true; socket.emit('code:typing', { problemId: selected, language, typing: true }); }
    setLiveStatus('Saving draft…');
    const timeout = setTimeout(() => socket.emit('code:update', { problemId: selected, language, sourceCode: code }, result => {
      typingRef.current = false;
      socket.emit('code:typing', { problemId: selected, language, typing: false });
      setLiveStatus(result?.ok ? 'Draft saved' : result?.message ?? 'Draft not saved');
    }), 500);
    return () => clearTimeout(timeout);
  }, [socket, selected, language, code, candidateId, draftReady, canManage, startedAt, codingAccess]);
  useEffect(() => { setStartedAt(technical.candidateStartedAt); }, [technical.candidateStartedAt]);
  useEffect(() => { setRoundReady(Boolean(technical.ready)); setCodingAccess(Boolean(technical.codingAccess)); setAssignedCandidateId(technical.candidateId ? String(technical.candidateId) : ''); }, [technical.ready, technical.codingAccess, technical.candidateId]);
  useEffect(() => { if (!startedAt) return undefined; const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick); }, [startedAt]);
  useEffect(() => { if (!socket) return undefined; const onReady = ({ candidateId: chosen }) => { setRoundReady(true); setAssignedCandidateId(String(chosen)); }; const onStart = ({ candidateId: chosen, startedAt: time }) => { setAssignedCandidateId(String(chosen)); setStartedAt(time); setCodingAccess(true); }; const onLocked = ({ reason }) => { setCodingAccess(false); setNotice(reason); }; const onResumed = () => { setCodingAccess(true); setNotice('Required media restored. Coding is unlocked.'); }; socket.on('coding:ready', onReady); socket.on('coding:started', onStart); socket.on('coding:locked', onLocked); socket.on('coding:resumed', onResumed); return () => { socket.off('coding:ready', onReady); socket.off('coding:started', onStart); socket.off('coding:locked', onLocked); socket.off('coding:resumed', onResumed); }; }, [socket]);

  async function create(event) {
    event.preventDefault();
    try {
      await api.post(`/interviews/${meetingCode}/problems`, {
        title: form.title,
        statement: form.statement,
        timeLimitSec: Number(form.timeLimitSec),
        allowedLanguages: ['javascript', 'cpp'],
        testCases: [
          { input: form.sampleInput, expectedOutput: form.sampleOutput, isHidden: false },
          { input: form.hiddenInput, expectedOutput: form.hiddenOutput, isHidden: true }
        ]
      });
      setForm(blank);
      setCreateOpen(false);
      setNotice('Problem saved. Review it, then reveal it to the candidate.');
      await load();
    } catch (error) {
      setNotice(error.response?.data?.message ?? 'Could not create problem.');
    }
  }
  async function reveal() {
    setRevealing(true);
    try {
      if (!selectedCandidateId) return setNotice('Select the participant who will be the candidate.');
      await api.post(`/meetings/by-code/${meetingCode}/reveal-problem`, { candidateId: selectedCandidateId });
      setRoundReady(true);
      setAssignedCandidateId(selectedCandidateId);
      setNotice('Coding round opened. The candidate can now complete the media check and start.');
    } catch (error) {
      setNotice(error.response?.data?.message ?? 'Could not reveal problem.');
    } finally {
      setRevealing(false);
    }
  }
  async function execute(action) {
    if (!problem) return;
    setRunning(true);
    setExecution(null);
    try {
      const { data } = await api.post(`/interviews/${meetingCode}/problems/${problem.id}/execute`, { language, sourceCode: code, action });
      setExecution(data);
    } catch (error) {
      setNotice(error.response?.data?.message ?? 'Execution failed.');
    } finally {
      setRunning(false);
    }
  }
  async function startCoding() {
    try {
      const data = onStartCoding ? await onStartCoding() : (await api.post(`/meetings/by-code/${meetingCode}/start-coding`)).data;
      setStartedAt(data.startedAt);
      setCodingAccess(true);
      setNotice('Coding timer started. Good luck!');
    } catch (error) {
      setNotice(error.response?.data?.message ?? error.message ?? 'Could not start the coding timer.');
    }
  }

  const change = key => event => setForm({ ...form, [key]: event.target.value });
  const timeLabel = secondsLeft == null ? (problem?.timeLimitSec ? `${Math.ceil(problem.timeLimitSec / 60)} min` : 'Timer not started') : `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const sampleTests = tests.filter(test => !test.isHidden);

  return <section className="technical-workspace interview-console">
    <header className="interview-console-header">
      <div className="interview-title">
        <span className="interview-code-mark">&lt;/&gt;</span>
        <div><p className="eyebrow">LIVE TECHNICAL INTERVIEW</p><h2>{problem?.title ?? 'Coding workspace'}</h2></div>
      </div>
      <div className="interview-statuses">
        {canManage && socket && <select className="candidate-view-select" aria-label="Candidate draft" value={selectedCandidateId} onChange={event => setSelectedCandidateId(event.target.value)} disabled={!candidates.length}><option value="">{candidates.length ? 'Select candidate' : 'Waiting for candidate'}</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>}
        <span className="sync-chip"><i /> {liveStatus}</span>
        <span className={`interview-timer ${secondsLeft === 0 ? 'timer-expired' : ''}`}>⏱ {timeLabel}</span>
        {isSelectedCandidate && roundReady && !startedAt && <button onClick={startCoding}>Start coding</button>}
        {canManage && problems.length === 0 && <button onClick={() => setCreateOpen(true)}>+ Add problem</button>}
        {canManage && problems.length > 0 && (!socket ? <span className="revealed-chip">✓ Problem ready</span> : startedAt ? <span className="revealed-chip">✓ Coding started</span> : <button onClick={reveal} disabled={revealing || !selectedCandidateId}>{revealing ? 'Saving…' : !selectedCandidateId ? 'Select candidate' : roundReady ? 'Update candidate' : 'Open coding round'}</button>)}
      </div>
    </header>

    {notice && <div className="interview-notice"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {problems.length === 0 ? <div className="workspace-empty interview-empty">
      <span className="empty-code-icon">{canManage ? '+' : '⌛'}</span>
      <strong>{canManage ? 'Create the interview challenge' : 'Waiting for the interviewer'}</strong>
      <p>{canManage ? 'Select one joined participant as candidate, then open the round. Only that candidate receives coding access.' : roundReady && !isSelectedCandidate ? 'The host selected another participant as the candidate. You can remain in the meeting as an observer or ask the host to promote you.' : roundReady ? 'Turn on camera and microphone, then click Start coding and share your screen. The problem appears when the timer begins.' : 'The coding problem will appear after a host selects you and opens the coding round.'}</p>
      {isSelectedCandidate && roundReady && !startedAt && <button onClick={startCoding}>Start coding</button>}
      {canManage && <button onClick={() => setCreateOpen(true)}>Add first problem</button>}
    </div> : <div className="workspace-grid interview-grid">
      <aside className="problem-list interview-nav">
        <p>CHALLENGES</p>
        {problems.map((item, index) => <button key={item.id} className={item.id === selected ? 'active' : ''} onClick={() => setSelected(item.id)}><b>{index + 1}</b><span>{item.title}<small>{Math.ceil(item.timeLimitSec / 60)} min</small></span></button>)}
        {canManage && <button className="add-problem-link" onClick={() => setCreateOpen(true)}>+ Add another</button>}
      </aside>

      <section className="problem-panel interview-problem">
        <div className="panel-heading"><span>PROBLEM</span><span>{sampleTests.length} sample{sampleTests.length === 1 ? '' : 's'}</span></div>
        <div className="problem-scroll">
          <h3>{problem?.title}</h3>
          <p className="problem-copy">{problem?.statement}</p>
          <h4>Examples</h4>
          {sampleTests.map((test, index) => <div className="test-case" key={test.id}>
            <strong>Example {index + 1}</strong>
            <small>INPUT</small><pre>{test.input || '(no input)'}</pre>
            <small>EXPECTED OUTPUT</small><pre>{test.expectedOutput}</pre>
          </div>)}
        </div>
      </section>

      <section className="editor-panel interview-editor">
        <div className="editor-toolbar">
          <div><span className="editor-file-dot" />solution.{language === 'javascript' ? 'js' : language === 'python' ? 'py' : 'cpp'}</div>
          <select aria-label="Programming language" value={language} onChange={event => { setDraftReady(false); setLanguage(event.target.value); setCode(template[event.target.value] ?? ''); setExecution(null); }}>{problem?.allowedLanguages.map(item => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="editor-host"><Editor height="100%" language={language} value={code} theme="vs-dark" onChange={value => setCode(value ?? '')} options={{ readOnly: canManage || Boolean(socket && (!draftReady || !startedAt || !codingAccess || secondsLeft === 0)), domReadOnly: canManage || Boolean(socket && (!draftReady || !startedAt || !codingAccess || secondsLeft === 0)), readOnlyMessage: { value: secondsLeft === 0 ? 'The coding time limit has ended.' : !codingAccess && startedAt ? 'Restore camera, microphone and screen sharing to continue.' : 'Click Start coding to unlock the editor.' }, minimap: { enabled: false }, automaticLayout: true, fontSize: 14, padding: { top: 14 }, scrollBeyondLastLine: false }} /></div>
        {execution && <div className={`execution-result interview-results ${execution.summary.passed === execution.summary.total ? 'all-passed' : ''}`}>
          <div className="result-summary"><strong>{execution.summary.passed === execution.summary.total ? '✓' : '!'} {execution.summary.passed}/{execution.summary.total} tests passed</strong><button aria-label="Close test results" onClick={() => setExecution(null)}>×</button></div>
          {execution.feedback && <p>{execution.feedback}</p>}
          {execution.results?.map((result, index) => <div className={result.passed ? 'result-pass' : 'result-fail'} key={index}>
            <strong>Test {index + 1}: {result.passed ? 'Passed' : 'Failed'}</strong>
            {!result.passed && <><small>Expected output</small><pre>{result.expectedOutput}</pre><small>Your output / error</small><pre>{result.compileError || result.stderr || result.stdout || '(no output)'}</pre></>}
          </div>)}
        </div>}
        <div className="run-panel interview-run-panel">
          <span>{canManage ? 'Read-only live candidate view' : !startedAt ? 'Click Start coding to unlock the editor' : !codingAccess ? 'Coding locked until required media is restored' : running ? 'Executing in secure container…' : secondsLeft === 0 ? 'Time limit reached' : liveStatus}</span>
          {!canManage && <><button className="secondary" disabled={running || secondsLeft === 0 || !draftReady || !codingAccess} onClick={() => execute('run')}>▷ Run samples</button><button disabled={running || secondsLeft === 0 || !draftReady || !codingAccess} onClick={() => execute('submit')}>{running ? 'Running…' : 'Submit solution'}</button></>}
        </div>
      </section>
    </div>}

    {createOpen && <div className="modal-backdrop"><form className="modal problem-form interview-problem-form" onSubmit={create}>
      <div className="modal-title"><div><p className="eyebrow">INTERVIEW SETUP</p><h2>Add coding problem</h2></div><button type="button" className="icon-button" onClick={() => setCreateOpen(false)}>×</button></div>
      <div className="problem-form-grid">
        <label>Problem title<input required value={form.title} onChange={change('title')} placeholder="e.g. Two Sum" /></label>
        <label>Time limit<input required type="number" min="60" value={form.timeLimitSec} onChange={change('timeLimitSec')} /><small>Seconds</small></label>
        <label className="form-wide">Problem statement<textarea required value={form.statement} onChange={change('statement')} placeholder="Describe the task, constraints and expected output…" /></label>
        <fieldset><legend>Visible sample test</legend><label>Input<textarea required value={form.sampleInput} onChange={change('sampleInput')} /></label><label>Expected output<textarea required value={form.sampleOutput} onChange={change('sampleOutput')} /></label></fieldset>
        <fieldset><legend>Hidden validation test</legend><label>Input<textarea required value={form.hiddenInput} onChange={change('hiddenInput')} /></label><label>Expected output<textarea required value={form.hiddenOutput} onChange={change('hiddenOutput')} /></label></fieldset>
      </div>
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button>Save problem</button></div>
    </form></div>}
  </section>;
}
