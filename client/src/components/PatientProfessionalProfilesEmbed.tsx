import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { BadgeCheck, Mail, Phone } from "lucide-react";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

type PatientVisibleProfessionalProfile = {
  professionalUserId: number;
  displayName: string;
  registrationNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  patientFacingBio: string | null;
};

export default function PatientProfessionalProfilesEmbed() {
  const [location] = useLocation();
  const shouldRender = location === "/" || location === "/today";
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!shouldRender) {
      setSlot(null);
      return;
    }
    const update = () => setSlot(document.querySelector("main"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shouldRender]);

  const procedure = (trpc as typeof trpc & {
    professionalRecord?: {
      settings?: {
        patientVisible?: {
          useQuery?: (
            input: undefined,
            options: { enabled: boolean; retry: boolean }
          ) => {
            data?: PatientVisibleProfessionalProfile[];
            isLoading: boolean;
            isError: boolean;
          };
        };
      };
    };
  }).professionalRecord?.settings?.patientVisible;
  const query = procedure?.useQuery?.(undefined, {
    enabled: shouldRender && Boolean(slot),
    retry: false,
  }) ?? {
    data: [] as PatientVisibleProfessionalProfile[],
    isLoading: false,
    isError: false,
  };

  if (!shouldRender || !slot || query.isLoading || query.isError) return null;
  const profiles = query.data ?? [];
  if (profiles.length === 0) return null;

  return createPortal(
    <section
      aria-labelledby="patient-professionals-title"
      className="mx-auto mt-6 w-full max-w-6xl px-4 sm:px-6"
    >
      <Card>
        <CardHeader>
          <CardTitle
            id="patient-professionals-title"
            className="flex items-center gap-2"
          >
            <BadgeCheck className="h-5 w-5" />
            Profissional do seu acompanhamento
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {profiles.map(profile => (
            <article
              key={profile.professionalUserId}
              className="rounded-xl border p-4"
            >
              <h3 className="font-semibold">{profile.displayName}</h3>
              {profile.registrationNumber ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Registro: {profile.registrationNumber}
                </p>
              ) : null}
              {profile.patientFacingBio ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                  {profile.patientFacingBio}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {profile.contactEmail ? (
                  <a
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    href={`mailto:${profile.contactEmail}`}
                  >
                    <Mail className="h-4 w-4" />
                    {profile.contactEmail}
                  </a>
                ) : null}
                {profile.contactPhone ? (
                  <a
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    href={`tel:${profile.contactPhone.replace(/[^+\d]/g, "")}`}
                  >
                    <Phone className="h-4 w-4" />
                    {profile.contactPhone}
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
    </section>,
    slot
  );
}
