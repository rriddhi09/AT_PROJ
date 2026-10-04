import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";

export function RecorderPage() {
  const { meetingCode } = useParams();
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState("");
  const [allowed, setAllowed] = useState(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  useEffect(() => {
    api
      .get(`/meetings/by-code/${meetingCode}`)
      .then(({ data }) => {
        setAllowed(data.membership?.role === "host");
        setRecording(Boolean(data.meeting?.recording?.active));
      })
      .catch(() => setAllowed(false));
    return () =>
      streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [meetingCode]);

  async function start() {
    if (!allowed) return setNotice("Only the host can start recording.");
    if (!consentConfirmed)
      return setNotice(
        "Confirm that participants were informed and applicable consent requirements were satisfied.",
      );
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      await api.post(`/meetings/by-code/${meetingCode}/recording/start`);
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : undefined,
      });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) =>
        event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `meeting-${meetingCode}-${Date.now()}.webm`;
        link.click();
        URL.revokeObjectURL(url);
        streamRef.current?.getTracks().forEach((track) => track.stop());
        try {
          await api.post(`/meetings/by-code/${meetingCode}/recording/stop`, {
            recordingUrl: "local-device-download",
          });
        } catch {
          /* Metadata may already have been stopped. */
        }
        setRecording(false);
        setNotice("Recording stopped and downloaded to this device.");
      };
      stream.getVideoTracks()[0].onended = () =>
        recorder.state !== "inactive" && recorder.stop();
      recorder.start(1000);
      setRecording(true);
      setNotice(
        "Recording started. Every participant now sees the recording indicator.",
      );
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setNotice(
        error.response?.data?.message ??
          "Screen recording was not started. Allow browser screen-sharing permission and try again.",
      );
    }
  }
  async function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      try {
        await api.post(`/meetings/by-code/${meetingCode}/recording/stop`, {
          recordingUrl: null,
        });
        setRecording(false);
        setNotice("Recording metadata was stopped.");
      } catch (error) {
        setNotice(
          error.response?.data?.message ?? "Recording could not be stopped.",
        );
      }
    }
  }

  return (
    <main className="prejoin">
      <Link to={`/rooms/${meetingCode}`}>← Back to meeting room</Link>
      <h1>Record meeting</h1>
      <p>
        This free browser recording saves directly to your device. All
        participants receive a visible recording notification and the meeting
        stores start/stop metadata.
      </p>
      <p>
        <strong>Privacy reminder:</strong> Recording and consent requirements
        vary by jurisdiction. The host is responsible for obtaining any legally
        required consent.
      </p>
      <label>
        <input
          type="checkbox"
          checked={consentConfirmed}
          onChange={(event) => setConsentConfirmed(event.target.checked)}
          disabled={recording}
        />{" "}
        Participants have been informed and required consent has been obtained.
      </label>
      <button
        disabled={allowed !== true || (!recording && !consentConfirmed)}
        onClick={recording ? stop : start}
      >
        {allowed === null
          ? "Checking permission..."
          : allowed === false
            ? "Only the host can record"
            : recording
              ? "Stop and download recording"
              : "Start recording"}
      </button>
      {notice && <p className="notice">{notice}</p>}
    </main>
  );
}
