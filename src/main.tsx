import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./themes.css";
import { ready } from "./i18n";
import { installExternalLinkHandler } from "./lib/desktop";

installExternalLinkHandler();

// Render once the saved language is loaded, so a non-English user never sees English first.
void ready.then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
