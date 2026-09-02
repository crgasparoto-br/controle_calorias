import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import AdminBillingPage from "../../client/src/pages/AdminBillingPage";
import "./visual.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function writeDiagnostics() {
  const root = document.documentElement;
  root.dataset.visualHorizontalOverflow = String(
    root.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth,
  );
  root.dataset.visualFocusableCount = String(
    document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])').length,
  );
  root.dataset.visualTableCount = String(document.querySelectorAll("table").length);
}

function VisualBillingAdmin() {
  useLayoutEffect(() => {
    const timer = window.setTimeout(writeDiagnostics, 700);
    window.addEventListener("resize", writeDiagnostics);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", writeDiagnostics);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AdminBillingPage />
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<VisualBillingAdmin />);
