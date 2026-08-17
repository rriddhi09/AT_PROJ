import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthPage } from './features/auth/AuthPage';
import { useAuth } from './features/auth/AuthProvider';
import { Dashboard } from './features/meetings/Dashboard';
import { PreJoinPage } from './features/meetings/PreJoinPage';
import { MeetingRoom } from './features/meetings/MeetingRoom';
import { FileSharePage } from './features/meetings/FileSharePage';
import { RecorderPage } from './features/meetings/RecorderPage';
function Protected({ children }) { const { user, loading } = useAuth(); if (loading) return <main className="loading">Loading secure session...</main>; return user ? children : <Navigate to="/auth" replace />; }
export default function App() { return <Routes><Route path="/auth" element={<AuthPage />} /><Route path="/dashboard" element={<Protected><Dashboard /></Protected>} /><Route path="/meetings/:meetingCode" element={<Protected><PreJoinPage /></Protected>} /><Route path="/rooms/:meetingCode" element={<Protected><MeetingRoom /></Protected>} /><Route path="/meetings/:meetingCode/files" element={<Protected><FileSharePage /></Protected>} /><Route path="/meetings/:meetingCode/record" element={<Protected><RecorderPage /></Protected>} /><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes>; }
