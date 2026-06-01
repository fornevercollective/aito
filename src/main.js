import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
const root = createRoot(document.getElementById("root"));
root.render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
// Register PWA service worker for offline + install on mobile
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Silent fail in dev or when not available
        });
    });
}
