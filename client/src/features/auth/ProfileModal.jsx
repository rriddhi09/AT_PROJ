import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { GoogleSignInButton } from "./GoogleSignInButton";

export function ProfileModal({ onClose }) {
  const { user, updateProfile, linkGoogle } = useAuth();
  const [form, setForm] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const change = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setSaved(false);
  };

  async function save(event) {
    event.preventDefault();
    setError("");
    if (form.newPassword !== form.confirmPassword)
      return setError("The new passwords do not match.");
    setBusy(true);
    try {
      const payload = { name: form.name, email: form.email };
      if (form.newPassword) {
        payload.currentPassword = form.currentPassword;
        payload.newPassword = form.newPassword;
      }
      const updated = await updateProfile(payload);
      setForm({
        name: updated.name,
        email: updated.email,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setSaved(true);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ?? "Could not save your profile.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function connectGoogle(credential) {
    setError("");
    setBusy(true);
    try {
      await linkGoogle(credential);
      setSaved(true);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ??
          "Google account could not be linked.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onSubmit={save}
      >
        <div className="modal-title">
          <div>
            <p className="eyebrow">YOUR ACCOUNT</p>
            <h2 id="profile-title">Edit profile</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close profile"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="profile-identity">
          <span className="profile-avatar">
            {user?.name?.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div>
            <strong>{user?.name}</strong>
            <small>{user?.email}</small>
          </div>
        </div>
        <label>
          Name
          <input
            required
            minLength="2"
            maxLength="80"
            autoComplete="name"
            value={form.name}
            onChange={change("name")}
          />
        </label>
        <label>
          Email
          <input
            required
            type="email"
            maxLength="254"
            autoComplete="email"
            value={form.email}
            onChange={change("email")}
          />
        </label>
        <div className="profile-password-heading">
          <strong>
            {user?.hasPassword ? "Change password" : "Add a password"}
          </strong>
          <small>
            {user?.hasPassword
              ? "Optional — leave blank to keep your current password."
              : "Optional — add a password if you also want email sign-in."}
          </small>
        </div>
        {user?.hasPassword && (
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={change("currentPassword")}
              required={Boolean(form.newPassword)}
            />
          </label>
        )}
        <label>
          New password
          <input
            type="password"
            minLength="8"
            maxLength="128"
            autoComplete="new-password"
            value={form.newPassword}
            onChange={change("newPassword")}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={change("confirmPassword")}
            required={Boolean(form.newPassword)}
          />
        </label>
        <div className="profile-google">
          <strong>Google account</strong>
          {user?.googleConnected ? (
            <span>✓ Connected</span>
          ) : (
            <>
              <small>
                Use the same email as this profile to link Google sign-in.
              </small>
              <GoogleSignInButton
                text="continue_with"
                onCredential={connectGoogle}
                onError={setError}
              />
            </>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="profile-saved" role="status">
            Profile saved.
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
          <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}
