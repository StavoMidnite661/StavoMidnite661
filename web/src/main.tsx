import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Landing } from "./Landing";
import { Console } from "./Console";

function App() {
  const [view, setView] = useState<"landing" | "console">("landing");
  if (view === "landing") return <Landing onEnter={() => setView("console")} />;
  return <Console onExit={() => setView("landing")} />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
