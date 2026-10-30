import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

async function boot(): Promise<void> {
  if (import.meta.env.MODE === "demo") {
    const { installDemoApi } = await import("./demo");
    installDemoApi();
  }
  const root = document.getElementById("root");
  if (root === null) throw new Error("#root element missing from index.html");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
