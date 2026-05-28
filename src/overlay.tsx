import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentOverlay } from "./components/AgentOverlay";

const container = document.getElementById("overlay-root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <AgentOverlay />
    </StrictMode>,
  );
}
