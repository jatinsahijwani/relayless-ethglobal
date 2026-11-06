import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Findings } from "./Findings";
import "./index.css";

createRoot(document.getElementById("root")!).render(<StrictMode>{window.location.pathname.replace(/\/$/, "") === "/findings" ? <Findings /> : <App />}</StrictMode>);
