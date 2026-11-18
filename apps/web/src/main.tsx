import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ReceiverPage } from "./pages/ReceiverPage.js";
import { StagePage } from "./pages/StagePage.js";
import "@fontsource/inter/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";

const el = document.getElementById("root")!;
const path = window.location.pathname;
const page = path === "/receiver" ? <ReceiverPage /> : path === "/stage" ? <StagePage /> : <App />;
createRoot(el).render(page);
