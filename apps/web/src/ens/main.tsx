import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EnsApp } from "./EnsApp";
import { Findings } from "../Findings";
import "../index.css";

createRoot(document.getElementById("root")!).render(<StrictMode>{window.location.pathname.replace(/\/$/, "") === "/findings" ? <Findings /> : <EnsApp />}</StrictMode>);
