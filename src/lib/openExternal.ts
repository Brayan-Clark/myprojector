// Ouverture d'un fichier avec l'application par défaut du système.
//
// L'application n'affiche nativement que les PDF, les images, les vidéos, les
// audios, le texte et le Markdown. Pour tout le reste (.pptx, .docx, .odp…),
// plutôt que d'imposer un convertisseur, on laisse la machine de l'utilisateur
// choisir : LibreOffice, WPS, OnlyOffice, ou tout ce qui est installé.

import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

/** Formats rendus directement dans la fenêtre de projection. */
const PROJECTABLE = /\.(pdf|txt|md|markdown)$/i;

export function isProjectableDocument(pathOrUrl: string): boolean {
  return PROJECTABLE.test(String(pathOrUrl).split(/[?#]/)[0]);
}

/** Extension en majuscules, pour l'affichage ("PPTX"). */
export function fileExtension(pathOrUrl: string): string {
  const clean = String(pathOrUrl).split(/[?#]/)[0];
  const ext = clean.includes(".") ? clean.split(".").pop() : "";
  return (ext || "fichier").toUpperCase();
}

/**
 * Ouvre un fichier avec le programme par défaut du système.
 * Renvoie un message d'erreur lisible plutôt que de lever.
 */
export async function openWithSystem(path: string): Promise<string | null> {
  try {
    await openPath(path);
    return null;
  } catch (e) {
    console.error("openWithSystem", path, e);
    return `Ouverture impossible : ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Ouvre le dossier contenant un fichier (ou le dossier lui-même). */
export async function revealInFolder(path: string): Promise<string | null> {
  try {
    await revealItemInDir(path);
    return null;
  } catch (e) {
    // Certains gestionnaires de fichiers ne gèrent pas la sélection d'un
    // élément : on retombe alors sur l'ouverture simple du dossier.
    try {
      await openPath(path);
      return null;
    } catch (e2) {
      console.error("revealInFolder", path, e, e2);
      return `Dossier introuvable : ${e2 instanceof Error ? e2.message : String(e2)}`;
    }
  }
}

/**
 * Ouvre une adresse web dans le NAVIGATEUR du système.
 *
 * Jamais dans une fenêtre de l'application : une page distante n'a rien à faire
 * dans le même webview que la projection.
 */
export async function openExternalUrl(url: string): Promise<string | null> {
  try {
    await openUrl(url);
    return null;
  } catch (e) {
    console.error("openExternalUrl", url, e);
    return `Ouverture impossible : ${e instanceof Error ? e.message : String(e)}`;
  }
}
