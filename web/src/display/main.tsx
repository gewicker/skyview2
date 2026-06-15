import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Display from "./Display";

createRoot(document.getElementById("root")!).render(
  <StrictMode><Display /></StrictMode>,
);
