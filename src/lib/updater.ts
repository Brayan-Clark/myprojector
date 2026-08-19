// Mise à jour de l'application.
//
// Règle de conduite : on NE met jamais à jour tout seul. L'application sert
// pendant un culte ; un redémarrage surprise au milieu d'une projection serait
// pire que la version périmée qu'il corrige. On vérifie, on propose, et c'est
// l'utilisateur qui décide du moment.

import { invoke } from "@tauri-apps/api/core";

/** Comment cette installation peut se mettre à jour (voir `update_install_kind`). */
export type InstallKind = "auto" | "manual";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string;
  date?: string;
  /** "manual" : paquet .deb/.rpm, l'installation automatique est impossible. */
  installKind: InstallKind;
}

/** Objet renvoyé par le plugin, conservé entre la vérification et l'installation. */
let pendingUpdate: any = null;

const SKIP_KEY = "updateSkippedVersion";
const LAST_CHECK_KEY = "updateLastCheck";
/** Une vérification par tranche de 6 h suffit : ce n'est pas un flux d'actualité. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Cherche une nouvelle version. Ne lève jamais : une mise à jour est un confort,
 * pas une fonction critique — hors ligne, l'application doit démarrer comme si
 * de rien n'était.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    if (!update) {
      pendingUpdate = null;
      return null;
    }
    pendingUpdate = update;
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body || "",
      date: update.date,
      installKind: await installKind(),
    };
  } catch (e) {
    console.warn("Vérification des mises à jour impossible :", e);
    return null;
  }
}

/** Vérification automatique au démarrage, espacée et respectant les refus. */
export async function checkForUpdateIfDue(): Promise<UpdateInfo | null> {
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
  if (Date.now() - last < CHECK_INTERVAL_MS) return null;

  const info = await checkForUpdate();
  if (!info) return null;
  // « Plus tard » sur une version donnée vaut pour cette version : la suivante
  // sera bien proposée.
  if (localStorage.getItem(SKIP_KEY) === info.version) return null;
  return info;
}

export function skipVersion(version: string) {
  localStorage.setItem(SKIP_KEY, version);
}

export const installKind = () =>
  invoke<InstallKind>("update_install_kind").catch(() => "manual" as InstallKind);

export const releasesUrl = () =>
  invoke<string>("releases_url").catch(() => "https://github.com/Brayan-Clark/myprojector/releases/latest");

/**
 * Télécharge et installe, puis redémarre l'application.
 * `onProgress` reçoit un pourcentage, ou `null` quand la taille est inconnue.
 */
export async function installUpdate(onProgress: (percent: number | null) => void): Promise<void> {
  if (!pendingUpdate) throw new Error("Aucune mise à jour en attente.");

  let total = 0;
  let received = 0;

  await pendingUpdate.downloadAndInstall((event: any) => {
    switch (event.event) {
      case "Started":
        total = event.data?.contentLength || 0;
        onProgress(total > 0 ? 0 : null);
        break;
      case "Progress":
        received += event.data?.chunkLength || 0;
        onProgress(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null);
        break;
      case "Finished":
        onProgress(100);
        break;
    }
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Version installée, affichée dans la bibliothèque. */
export async function currentVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
