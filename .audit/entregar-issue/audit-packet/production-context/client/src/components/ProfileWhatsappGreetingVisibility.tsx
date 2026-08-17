import { trpc } from "@/lib/trpc";
import { useEffect } from "react";
import { useLocation } from "wouter";

const GREETING_TITLE = "Saudação pelo WhatsApp";
const GREETING_CONTEXT_COPY = "O WhatsApp é o canal principal";
const SETTINGS_ROUTES = new Set(["/settings", "/onboarding"]);

type GreetingVisibilityInput = {
  isSettingsRoute: boolean;
  hasActiveProfessionalProfile: boolean;
  hasGreetingCardContext: boolean;
};

export function isWhatsappGreetingSettingsRoute(location: string) {
  return SETTINGS_ROUTES.has(location);
}

export function shouldShowWhatsappGreetingBlock({
  isSettingsRoute,
  hasActiveProfessionalProfile,
  hasGreetingCardContext,
}: GreetingVisibilityInput) {
  return isSettingsRoute && hasActiveProfessionalProfile && hasGreetingCardContext;
}

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function findWhatsappGreetingCard() {
  if (typeof document === "undefined") return null;

  const title = Array.from(document.querySelectorAll("h1, h2, h3, div, span, p, [role='heading']")).find(element =>
    elementText(element) === GREETING_TITLE,
  );
  if (!title) return null;

  let current = title.parentElement;
  while (current) {
    const text = elementText(current);
    if (text.includes(GREETING_TITLE) && text.includes(GREETING_CONTEXT_COPY)) {
      return current as HTMLElement;
    }
    current = current.parentElement;
  }

  return null;
}

function updateGreetingCardVisibility(hasActiveProfessionalProfile: boolean, isSettingsRoute: boolean) {
  const card = findWhatsappGreetingCard();
  if (!card) return;

  const shouldShow = shouldShowWhatsappGreetingBlock({
    isSettingsRoute,
    hasActiveProfessionalProfile,
    hasGreetingCardContext: true,
  });

  card.hidden = !shouldShow;
  card.setAttribute("aria-hidden", shouldShow ? "false" : "true");
}

export default function ProfileWhatsappGreetingVisibility() {
  const [location] = useLocation();
  const isSettingsRoute = isWhatsappGreetingSettingsRoute(location);
  const professionalProfile = trpc.nutrition.professionals.profile.useQuery(undefined, {
    enabled: isSettingsRoute,
    retry: false,
  });
  const hasActiveProfessionalProfile = isSettingsRoute && Boolean(professionalProfile.data?.active);

  useEffect(() => {
    if (!isSettingsRoute) return;

    const updateVisibility = () => updateGreetingCardVisibility(hasActiveProfessionalProfile, isSettingsRoute);
    updateVisibility();

    const observer = new MutationObserver(updateVisibility);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [hasActiveProfessionalProfile, isSettingsRoute]);

  return null;
}
