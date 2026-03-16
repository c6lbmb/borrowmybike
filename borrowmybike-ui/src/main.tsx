import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";

// IMPORTANT: your project uses this path
import "./styles/app.css";

// PWA: install-to-home-screen + offline shell
import { registerSW } from "virtual:pwa-register";


registerSW({
  immediate: true,
  onOfflineReady() {
    console.log("[PWA] Offline ready");
  },
  onNeedRefresh() {
    console.log("[PWA] New content available; refresh to update.");
  },
});

// --- Google Analytics (BorrowMyBike) ---
const GA_ID = "G-2TYW8DBQT8";

if (typeof window !== "undefined") {
  const gtagScript = document.createElement("script");
  gtagScript.async = true;
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(gtagScript);

  const inlineScript = document.createElement("script");
  inlineScript.innerHTML = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', '${GA_ID}');
  `;
  document.head.appendChild(inlineScript);
}


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
