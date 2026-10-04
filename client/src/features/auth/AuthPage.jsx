import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { GoogleSignInButton } from "./GoogleSignInButton";

export function AuthPage() {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const { login, register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = location.state?.from || "/dashboard";

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await (mode === "login" ? login(form) : register(form));
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message ?? "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle(credential) {
    setError("");
    setBusy(true);
    try {
      await googleLogin(credential);
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ??
          "Google sign-in could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">UNIFIED INTERVIEW</p>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="muted">
          Secure meetings and technical interviews in one workspace.
        </p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <label>
              Name
              <input
                required
                minLength="2"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
          )}
          <label>
            Email
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              minLength="8"
              value={form.password}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        <div className="auth-divider">
          <span>or</span>
        </div>
        <GoogleSignInButton
          text={mode === "login" ? "signin_with" : "signup_with"}
          onCredential={signInWithGoogle}
          onError={setError}
        />
        <button
          className="link-button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
