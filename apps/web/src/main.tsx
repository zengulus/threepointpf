import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThreePointPfApp } from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><ThreePointPfApp /></StrictMode>);
