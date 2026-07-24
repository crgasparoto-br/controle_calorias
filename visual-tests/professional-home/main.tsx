import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import ProfessionalAreaPage from "../../client/src/pages/ProfessionalAreaPage";
import "./visual.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

function VisualProfessionalArea() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sidebar") !== "collapsed") return;
    const timer = window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')
        ?.click();
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ProfessionalAreaPage />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VisualProfessionalArea />
  </React.StrictMode>
);
