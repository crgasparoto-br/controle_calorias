import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import ProfessionalOperationalAlertsPanel from "./ProfessionalOperationalAlertsPanel";

const supportedRoutes = new Set([
  "/professional",
  "/professional/patients",
  "/professional/follow-up",
]);

export default function ProfessionalOperationalAlertsBridge() {
  const [location] = useLocation();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!supportedRoutes.has(location)) {
      setTarget(null);
      return;
    }
    const resolve = () => {
      const main = document.querySelector<HTMLElement>(
        "main[aria-label='Início'], main[aria-label='Pacientes'], main[aria-label='Acompanhamento']"
      );
      setTarget(main);
    };
    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location]);

  const endpointAvailable = Boolean(
    (trpc as unknown as {
      professionalRecord?: {
        operationalAlerts?: { list?: { useQuery?: unknown } };
      };
    }).professionalRecord?.operationalAlerts?.list?.useQuery
  );

  if (!target || !endpointAvailable) return null;
  return createPortal(
    <section
      className="mx-auto mb-6 max-w-6xl"
      aria-label="Central de pendências operacionais"
    >
      <ProfessionalOperationalAlertsPanel />
    </section>,
    target
  );
}
