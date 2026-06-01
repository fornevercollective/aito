import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
const root = createRoot(document.getElementById("root"));
root.render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
// Register PWA service worker (uses relative path so it works under /aito/ on GitHub Pages)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swUrl = import.meta.env.BASE_URL ? `${import.meta.env.BASE_URL}sw.js` : '/sw.js';
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Silent fail in dev or when not available
        });
    });
}
