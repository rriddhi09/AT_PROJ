import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { ProfileModal } from "../auth/ProfileModal";

const blank = {
  title: "",
  description: "",
  type: "normal",
  accessType: "private",
  scheduledAt: "",
};
function DashboardIcon({ kind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "video" ? (
        <>
          <rect x="3" y="6" width="13" height="12" rx="2" />
          <path d="m16 10 5-3v10l-5-3" />
        </>
      ) : kind === "shield" ? (
        <>
          <path d="m12 2 8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6l8-4Z" />
          <path d="m9 12 2 2 4-4" />
        </>
      ) : kind === "link" ? (
        <>
          <path d="M10 13a5 5 0 0 0 7 .3l2-2a5 5 0 0 0-7-7l-1.2 1.2M14 11a5 5 0 0 0-7-.3l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
        </>
      ) : kind === "calendar" ? (
        <>
          <rect x="4" y="5" width="16" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
    </svg>
  );
}

export function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const meetingTrack = useRef(null);
  const [meetings, setMeetings] = useState([]);
  const [carousel, setCarousel] = useState({ previous: false, next: false });
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [showAll, setShowAll] = useState(false);
  const change = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const load = async () => {
    try {
      setMeetings((await api.get("/meetings")).data.meetings);
    } catch {
      setError("Could not load your meetings. Please refresh.");
    }
  };

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const track = meetingTrack.current;
    if (!track) return;
    const update = () =>
      setCarousel({
        previous: track.scrollLeft > 2,
        next: track.scrollLeft + track.clientWidth < track.scrollWidth - 2,
      });
    update();
    track.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      track.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [meetings, showAll]);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { ...form };
      if (payload.scheduledAt)
        payload.scheduledAt = new Date(payload.scheduledAt).toISOString();
      else delete payload.scheduledAt;
      const { data } = await api.post("/meetings", payload);
      setOpen(false);
      setForm(blank);
      navigate(data.joinPath);
    } catch (e) {
      setError(e.response?.data?.message ?? "Could not create the meeting.");
    } finally {
      setBusy(false);
    }
  }

  function join(event) {
    event.preventDefault();
    const value = joinCode.trim();
    if (!value) return;
    try {
      const link = new URL(value);
      navigate(`${link.pathname}${link.search}`);
    } catch {
      const code = value.split("?")[0].split("/").filter(Boolean).pop();
      const query = value.includes("?")
        ? `?${value.split("?").slice(1).join("?")}`
        : "";
      if (code) navigate(`/meetings/${code}${query}`);
    }
  }

  const scrollMeetings = (direction) =>
    meetingTrack.current?.scrollBy({
      left: direction * meetingTrack.current.clientWidth,
      behavior: "smooth",
    });
  const upcomingMeetings = meetings.filter(
    ({ meeting }) =>
      !["ENDED", "CANCELLED", "EXPIRED"].includes(meeting.status) &&
      (["LIVE", "PAUSED", "WAITING_TO_START"].includes(meeting.status) ||
        !meeting.scheduledAt ||
        new Date(meeting.scheduledAt).getTime() >= Date.now()),
  );
  const displayedMeetings = showAll ? meetings : upcomingMeetings;

  return (
    <main className="dashboard">
      <nav>
        <strong>Unified Interview</strong>
        <div>
          <button
            className="dashboard-profile-button"
            onClick={() => setProfileOpen(true)}
            aria-label="Open your profile"
          >
            <span className="dashboard-profile-avatar">
              {user?.name?.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span>{user?.name}</span>
          </button>
          <button
            className="dashboard-signout"
            onClick={async () => {
              await logout();
              navigate("/auth");
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <section className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">
              <span /> DASHBOARD
            </p>
            <h1>Meet with purpose.</h1>
            <p>
              Create, schedule, and manage focused interviews before anyone
              joins.
            </p>
            <div className="dashboard-features">
              <div>
                <span>
                  <DashboardIcon kind="video" />
                </span>
                <p>
                  <strong>Simple setup</strong>
                  <small>Ready in seconds</small>
                </p>
              </div>
              <div>
                <span>
                  <DashboardIcon kind="shield" />
                </span>
                <p>
                  <strong>Private by design</strong>
                  <small>Secure invite links</small>
                </p>
              </div>
              <div>
                <span>
                  <DashboardIcon kind="clock" />
                </span>
                <p>
                  <strong>Stay organized</strong>
                  <small>Everything in one place</small>
                </p>
              </div>
            </div>
          </div>
          <button onClick={() => setOpen(true)}>＋&nbsp; Create meeting</button>
        </div>
        <section className="join-bar">
          <form onSubmit={join}>
            <label>
              <span>
                <DashboardIcon kind="link" /> Join with a secure meeting link
              </span>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Paste the complete invite link"
              />
            </label>
            <button disabled={!joinCode.trim()}>Join&nbsp; →</button>
          </form>
        </section>
        {error && <p className="error">{error}</p>}
        <section className="meeting-section">
          <div className="meeting-section-head">
            <div>
              <p className="eyebrow">YOUR SCHEDULE</p>
              <h2>{showAll ? "All meetings" : "Upcoming meetings"}</h2>
              <p>
                {showAll
                  ? "Every meeting in one place."
                  : "Everything you have planned, at a glance."}
              </p>
            </div>
            <div className="meeting-section-actions">
              {meetings.length > 0 && (
                <button
                  className="view-all-meetings"
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? "View upcoming" : "View all meetings"}
                </button>
              )}
              {!showAll && (carousel.previous || carousel.next) && (
                <div className="meeting-carousel-controls">
                  <button
                    type="button"
                    aria-label="Previous meetings"
                    disabled={!carousel.previous}
                    onClick={() => scrollMeetings(-1)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label="Next meetings"
                    disabled={!carousel.next}
                    onClick={() => scrollMeetings(1)}
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          </div>
          {displayedMeetings.length === 0 ? (
            <div className="empty-state">
              <strong>
                {meetings.length ? "No upcoming meetings" : "No meetings yet"}
              </strong>
              <p>
                {meetings.length
                  ? "View all meetings to see earlier sessions."
                  : "Create a meeting to get started."}
              </p>
              <button
                type="button"
                onClick={() =>
                  meetings.length ? setShowAll(true) : setOpen(true)
                }
              >
                {meetings.length ? "View all meetings" : "Create meeting"}
              </button>
            </div>
          ) : (
            <div
              className={`meeting-grid ${showAll ? "meeting-all" : "meeting-carousel"}`}
              ref={meetingTrack}
              aria-label={showAll ? "All meetings" : "Upcoming meetings"}
            >
              {displayedMeetings.map(({ meeting, role }) => (
                <button
                  className="meeting-card"
                  key={meeting._id}
                  onClick={() => navigate(`/meetings/${meeting.meetingCode}`)}
                >
                  <span className="meeting-card-top">
                    <span className="badge">
                      {meeting.type === "technical_interview"
                        ? "Interview"
                        : "Meeting"}
                    </span>
                    <span aria-hidden="true">···</span>
                  </span>
                  <h3>{meeting.title}</h3>
                  <p className="meeting-card-description">
                    {meeting.description || "No description provided."}
                  </p>
                  <span className="meeting-card-meta">
                    <span>
                      <DashboardIcon kind="calendar" />
                      {meeting.scheduledAt
                        ? new Date(meeting.scheduledAt).toLocaleDateString()
                        : "Start anytime"}
                    </span>
                    <span>
                      {meeting.accessType} · {role}
                    </span>
                  </span>
                </button>
              ))}
              {!showAll && (
                <button
                  className="meeting-create-tile"
                  type="button"
                  onClick={() => setOpen(true)}
                  aria-label="Create another meeting"
                >
                  <span>＋</span>
                  <strong>New meeting</strong>
                </button>
              )}
            </div>
          )}
        </section>
      </section>
      {open && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={create}>
            <div className="modal-title">
              <div>
                <p className="eyebrow">NEW SESSION</p>
                <h2>Create a meeting</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <label>
              Title
              <input
                required
                minLength="3"
                value={form.title}
                onChange={change("title")}
              />
            </label>
            <label>
              Description
              <textarea
                value={form.description}
                onChange={change("description")}
              />
            </label>
            <label>
              Session type
              <select value={form.type} onChange={change("type")}>
                <option value="normal">Normal meeting</option>
                <option value="technical_interview">Technical interview</option>
              </select>
            </label>
            <label>
              Access
              <select value={form.accessType} onChange={change("accessType")}>
                <option value="private">Private - approve participants</option>
                <option value="public">
                  Public - participants join directly
                </option>
              </select>
            </label>
            <label>
              Schedule for (optional)
              <input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={change("scheduledAt")}
              />
            </label>
            <button disabled={busy}>
              {busy ? "Creating..." : "Create secure link"}
            </button>
          </form>
        </div>
      )}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </main>
  );
}
