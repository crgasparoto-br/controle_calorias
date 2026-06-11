import { PatientAccessRequestsCard } from "@/components/ProfessionalProfileSettings";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

const SLOT_ATTRIBUTE = "data-profile-access-requests-root";
const SETTINGS_TITLE_COPY = "Atualize seus dados, metas e acompanhamentos";
const SAVE_PROFILE_LABEL = "Salvar perfil";

function elementText(element: Element) {
  return element.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function replaceExactText(currentText: string, nextText: string) {
  const element = Array.from(document.querySelectorAll("h1, h2, h3, div, span, p, [role='heading']")).find(item =>
    elementText(item) === currentText,
  );

  if (element) element.textContent = nextText;
}

function updateSettingsCopy() {
  if (typeof document === "undefined") return;

  replaceExactText("Ajuste seu perfil sem se perder em blocos longos", SETTINGS_TITLE_COPY);
  replaceExactText("módulo nutricionista", "área profissional");
}

function findSaveProfileButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button =>
    elementText(button).includes(SAVE_PROFILE_LABEL),
  ) ?? null;
}

function findProfileCardContent(saveButton: HTMLButtonElement) {
  let current: Element | null = saveButton.parentElement;

  while (current) {
    const text = elementText(current);
    if (text.includes("Identificação e base física") && text.includes("Nome") && text.includes("Peso atual")) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function findProfileAccessSlot() {
  if (typeof document === "undefined") return null;

  const saveButton = findSaveProfileButton();
  if (!saveButton) return null;

  const profileContent = findProfileCardContent(saveButton);
  if (!profileContent) return null;

  const existingSlot = profileContent.querySelector<HTMLDivElement>(`[${SLOT_ATTRIBUTE}='true']`);
  if (existingSlot) return existingSlot;

  const slot = document.createElement("div");
  slot.setAttribute(SLOT_ATTRIBUTE, "true");

  const saveButtonArea = saveButton.parentElement;
  profileContent.insertBefore(slot, saveButtonArea ?? null);

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
      updateSettingsCopy();
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
