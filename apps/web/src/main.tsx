import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThreePointPfApp } from "./App";
import { HostedAccountApp } from "./components/hosted-account-app";
import { LocalAccountApp } from "./components/local-account-app";
import { sheetMode } from "./lib/repository";

const AccountApp = sheetMode() === "hosted" ? HostedAccountApp : LocalAccountApp;
createRoot(document.getElementById("root")!).render(<StrictMode><AccountApp><ThreePointPfApp /></AccountApp></StrictMode>);
