import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useLayoutEffect } from "react";
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
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sidebar") !== "collapsed") return;
    document.documentElement.classList.add("visual-no-motion");
    document
      .querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')
      ?.click();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ProfessionalAreaPage />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<VisualProfessionalArea />);
