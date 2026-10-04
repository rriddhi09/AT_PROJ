import { useEffect, useRef } from "react";

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

export function GoogleSignInButton({
  onCredential,
  onError,
  text = "continue_with",
}) {
  const container = useRef(null);
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    const render = () => {
      if (!active || !container.current || !window.google?.accounts?.id) return;
      container.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (!active) return;
          if (response.credential)
            handlers.current.onCredential(response.credential);
          else
            handlers.current.onError?.(
              "Google did not return a sign-in token. Please try again.",
            );
        },
      });
      window.google.accounts.id.renderButton(container.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text,
        width: 320,
      });
    };
    let script = document.getElementById("google-identity-script");
    if (!script) {
      script = document.createElement("script");
      script.id = "google-identity-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      document.head.appendChild(script);
    }
    const failed = () =>
      handlers.current.onError?.(
        "Google sign-in could not load. Check your internet connection.",
      );
    script.addEventListener("load", render);
    script.addEventListener("error", failed);
    render();
    return () => {
      active = false;
      script.removeEventListener("load", render);
      script.removeEventListener("error", failed);
    };
  }, [text]);

  return clientId ? (
    <div className="google-button-wrap" ref={container} />
  ) : (
    <div className="google-button-wrap google-unconfigured">
      <button
        type="button"
        disabled
        title="Add your Google Web client ID to enable this button"
      >
        Continue with Google
      </button>
      <p className="google-setup-note">
        Add your Google client ID to enable this option.
      </p>
    </div>
  );
}
