import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Control from "./Control";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Control /></StrictMode>,
);
