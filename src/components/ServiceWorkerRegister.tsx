"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (public/sw.js) on mount.
 * Rendered once from the root layout.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Register after load so it never competes with the initial page load.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silently ignore — PWA install/offline support is a progressive
        // enhancement, not a hard requirement for the app to work.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
