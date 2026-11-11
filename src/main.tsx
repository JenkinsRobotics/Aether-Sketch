import {Home} from './home/Home';
import {shouldShowHome} from '@aether/session/home/runtime';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@aether/ui/tokens.css";
import "@aether/ui/widgets.css";
import { RecoveryWorkspace } from "./RecoveryWorkspace";

createRoot(document.getElementById("root")!).render(<StrictMode>{shouldShowHome() ? <Home/> : <RecoveryWorkspace/>}</StrictMode>);
