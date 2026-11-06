import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EnsApp } from "./EnsApp";
import "../index.css";

createRoot(document.getElementById("root")!).render(<StrictMode><EnsApp /></StrictMode>);
