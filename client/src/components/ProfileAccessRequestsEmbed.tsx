import { PatientAccessRequestsCard } from "@/components/ProfessionalProfileSettings";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

const SLOT_ATTRIBUTE = "data-profile-access-requests-root";
const SETTINGS_TITLE_COPY = "Atualize seus dados, metas e acompanhamentos";

function updateSettingsTitle() {
  if (typeof document === "undefined") return;

  const title = Array.from(document.querySelectorAll("h1, h2, [role='heading']")).find(element =>
    element.textContent?.trim() === "Ajuste seu perfil sem se perder em blocos longos",
  );

  if (title) title.textContent = SETTINGS_TITLE_COPY;
}

function hasClassName(element: Element, className: string) {
  return element.className.toString().includes(className);
}

function findTextElement(text: string) {
  const elements = Array.from(document.querySelectorAll("h1, h2, h3, div, span, p, [role='heading']"));
  return elements.find(element => element.textContent?.trim() === text) ?? null;
}

function findProfileCard(title: Element) {
  let current = title.parentElement;

  while (current) {
    if (hasClassName(current, "shadow-sm") && current.textContent?.includes("Peso atual")) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function findProfileCardContent(card: Element) {
  const contents = Array.from(card.querySelectorAll("div"));
  return contents.find(element => {
    const text = element.textContent ?? "";
    return hasClassName(element, "space-y-4") && text.includes("Nome") && text.includes("Peso atual") && text.includes("Salvar perfil");
  }) ?? null;
}

function findProfileAccessSlot() {
  if (typeof document === "undefined") return null;

  const title = findTextElement("Identificação e base física");
  if (!title) return null;

  const card = findProfileCard(title);
  if (!card) return null;

  const content = findProfileCardContent(card);
  if (!content) return null;

  const existingSlot = content.querySelector<HTMLDivElement>(`[${SLOT_ATTRIBUTE}='true']`);
  if (existingSlot) return existingSlot;

  const slot = document.createElement("div");
  slot.setAttribute(SLOT_ATTRIBUTE, "true");

  const saveButtonArea = Array.from(content.children).find(element =>
    element.textContent?.includes("Salvar perfil"),
  );
  content.insertBefore(slot, saveButtonArea ?? null);

  return slot;
}

export default function ProfileAccessRequestsEmbed() {
  const [location] = useLocation();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const shouldRender = location === "/settings" || location === "/onboarding";

  useEffect(() => {
    if (!shouldRender) {
      setSlot(null);
      return;
    }

    const updateSlot = () => {
      updateSettingsTitle();
      setSlot(findProfileAccessSlot());
    };
    updateSlot();

    const observer = new MutationObserver(updateSlot);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [shouldRender]);

  if (!shouldRender || !slot) return null;

  return createPortal(<PatientAccessRequestsCard embedded />, slot);
}
