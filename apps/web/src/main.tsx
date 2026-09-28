import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThreePointPfApp } from "./App";
import { LocalAccountApp } from "./components/local-account-app";

createRoot(document.getElementById("root")!).render(<StrictMode><LocalAccountApp><ThreePointPfApp /></LocalAccountApp></StrictMode>);
