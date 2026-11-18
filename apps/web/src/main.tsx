import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ReceiverPage } from "./pages/ReceiverPage.js";
import "./styles.css";

const el = document.getElementById("root")!;
const isReceiver = window.location.pathname === "/receiver";
createRoot(el).render(isReceiver ? <ReceiverPage /> : <App />);
