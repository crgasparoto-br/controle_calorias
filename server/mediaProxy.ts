import type { Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { storageRead } from "./storage";

function readQueryString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  return null;
}

export async function handleMediaRequest(req: Request, res: Response) {
  try {
    await sdk.authenticateRequest(req);
  } catch {
    res.status(401).json({ message: "Sessão inválida." });
    return;
  }

  const key = readQueryString(req.query.key);
  if (!key) {
    res.status(400).json({ message: "Arquivo não informado." });
    return;
  }

  try {
    const media = await storageRead(key);
    res.setHeader("Content-Type", media.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(media.data);
  } catch (error) {
    console.warn("[Media] Failed to read stored media:", error);
    res.status(404).json({ message: "Arquivo não encontrado." });
  }
}
