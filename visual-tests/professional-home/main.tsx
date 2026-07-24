import React from "react";
import { createRoot } from "react-dom/client";
import ProfessionalHome from "../../client/src/pages/professional/ProfessionalHome";
import "./visual.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="min-h-screen bg-background p-4 text-foreground md:p-6">
      <ProfessionalHome />
    </div>
  </React.StrictMode>
);
