import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Airport from "./Airport";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Airport /></StrictMode>,
);
