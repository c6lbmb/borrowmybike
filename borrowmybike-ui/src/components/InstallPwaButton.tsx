import React from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;

  // iOS
  const iosStandalone = (window.navigator as any).standalone === true;

  // Modern browsers
  const displayModeStandalone =
    window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;

  return iosStandalone || displayModeStandalone;
}

export default function InstallPwaButton({ visible = true }: { visible: boolean }) {
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);
  const [showIosHint, setShowIosHint] = React.useState(false);

  React.useEffect(() => {
    // If already running as installed app, hide UI
    setInstalled(isInStandaloneMode());

    const onBeforeInstallPrompt = (e: Event) => {
      // Android Chrome / desktop Chrome will fire this
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      setShowIosHint(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (installed) return null;

  const onClickInstall = async () => {
    // iOS doesn’t support beforeinstallprompt
    if (isIos()) {
      setShowIosHint(true);
      return;
    }

    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      // Regardless of outcome, the prompt can’t be reused reliably
      setDeferredPrompt(null);
    }
  };

  // Show button on iOS (as a “how to install” helper),
  // OR when Android prompt is available.
  const shouldShowButton = isIos() || !!deferredPrompt;

  if (!shouldShowButton || !visible) return null;
  return (
   <div
  style={{
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 12,
  }}
>
      <button
        type="button"
        onClick={onClickInstall}
        style={{
          border: "1px solid #e2e8f0",
          background: "#fff",
          borderRadius: 999,
          padding: "10px 12px",
          fontWeight: 900,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Install BorrowMyBike
      </button>

      {showIosHint && (
        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.35 }}>
          iPhone/iPad: tap <b>Share</b> → <b>Add to Home Screen</b>.
        </div>
      )}
    </div>
  );
}