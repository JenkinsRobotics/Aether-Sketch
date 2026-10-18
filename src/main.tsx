import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@aether/ui/tokens.css";
import "@aether/ui/widgets.css";
import { RecoveryWorkspace } from "./RecoveryWorkspace";

if (location.pathname.startsWith('/sketch/') && !new URLSearchParams(location.search).has('document') && !new URLSearchParams(location.search).has('editor')) {
  location.replace('/?home=sketch');
} else createRoot(document.getElementById("root")!).render(<StrictMode><RecoveryWorkspace /></StrictMode>);
