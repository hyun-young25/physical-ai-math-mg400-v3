import { createRoot } from "react-dom/client";
import LearningShell from "./LearningShell";
import "./index.css";
import { TutorHost } from "./TutorHost";

createRoot(document.getElementById("root")!).render(<><LearningShell /><TutorHost /></>);
