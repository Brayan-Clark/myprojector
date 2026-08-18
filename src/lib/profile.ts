// Sauvegarde et restauration du profil : réglages, agenda du jour et liste des
// contenus installés. Pensé pour installer un poste supplémentaire sans tout
// reconfigurer à la main.
//
// Ce qui N'EST PAS dans le fichier : les médias et les fonds (des centaines de
// Mo), les bases téléchargées, et tout ce qui est propre à la machine
// (chemin des données, caméra choisie, état de projection en cours). Le fichier
// reste ainsi de quelques Ko, lisible et transportable par clé USB.

import { invoke } from "@tauri-apps/api/core";
import { DATA_BASE, docFileName, listInstalled, type DocsManifest } from "./library";

export const PROFILE_VERSION = 1;

/** Clés de réglages transportables d'une machine à l'autre. */
const SETTINGS_KEYS = [
  "appSettings",
  "appSpecificSettings",
  "clockSettings",
  "tickerSettings",
  "favoriteDbs",
  "currentPlaylist",
];

export interface Profile {
  version: number;
  exportedAt: string;
  settings: Record<string, string>;
  installed: {
    hymnes: string[];
    bible: string[];
    docs: string[];
    mofonaina: string[];
  };
}

export async function buildProfile(): Promise<Profile> {
  const settings: Record<string, string> = {};
  for (const key of SETTINGS_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) settings[key] = value;
  }

  const safeList = async (kind: "docs" | "mofonaina") =>
    (await listInstalled(kind).catch(() => [])).map((f) => f.filename);

  return {
    version: PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    installed: {
      hymnes: await invoke<string[]>("list_dbs", { category: "hymnes" }).catch(() => []),
      bible: await invoke<string[]>("list_dbs", { category: "bible" }).catch(() => []),
      docs: await safeList("docs"),
      mofonaina: await safeList("mofonaina"),
    },
  };
}

/** Restaure les réglages. Les contenus, eux, se réinstallent séparément. */
export function applyProfileSettings(profile: Profile): number {
  let applied = 0;
  for (const [key, value] of Object.entries(profile.settings || {})) {
    if (!SETTINGS_KEYS.includes(key)) continue; // on n'injecte rien d'inattendu
    localStorage.setItem(key, value);
    applied++;
  }
  return applied;
}

export interface MissingItem {
  kind: "hymnes" | "bible" | "docs" | "mofonaina";
  filename: string;
  label: string;
  url: string | null;
}

/**
 * Compare le profil au contenu réellement présent et renvoie ce qui manque,
 * avec l'URL de téléchargement quand elle est connue.
 */
export async function findMissing(profile: Profile): Promise<MissingItem[]> {
  const missing: MissingItem[] = [];

  for (const category of ["hymnes", "bible"] as const) {
    const wanted: string[] = profile.installed?.[category] || [];
    if (wanted.length === 0) continue;
    const present = await invoke<string[]>("list_dbs", { category }).catch(() => [] as string[]);
    const absent = wanted.filter((f) => !present.includes(f));
    if (absent.length === 0) continue;

    let versions: any[] = [];
    try {
      const res = await fetch(`${DATA_BASE}/${category}/manifest.json?c=${Date.now()}`);
      if (res.ok) versions = (await res.json()).versions || [];
    } catch { /* hors ligne : on signalera sans URL */ }

    for (const filename of absent) {
      const found = versions.find((v: any) => v.file === filename);
      missing.push({
        kind: category, filename,
        label: found?.name || filename,
        url: found?.url || null,
      });
    }
  }

  const wantedDocs = profile.installed?.docs || [];
  if (wantedDocs.length > 0) {
    const present = (await listInstalled("docs").catch(() => [])).map((f) => f.filename);
    const absent = wantedDocs.filter((f) => !present.includes(f));
    if (absent.length > 0) {
      let manifest: DocsManifest | null = null;
      try {
        const res = await fetch(`${DATA_BASE}/docs/manifest.json?c=${Date.now()}`);
        if (res.ok) manifest = await res.json();
      } catch { /* hors ligne */ }
      for (const filename of absent) {
        const doc = manifest?.documents.find((d) => docFileName(d) === filename);
        missing.push({
          kind: "docs", filename,
          label: doc?.title || filename,
          url: doc?.url || null,
        });
      }
    }
  }

  const wantedMofo = profile.installed?.mofonaina || [];
  if (wantedMofo.length > 0) {
    const present = (await listInstalled("mofonaina").catch(() => [])).map((f) => f.filename);
    for (const filename of wantedMofo.filter((f) => !present.includes(f))) {
      missing.push({
        kind: "mofonaina", filename,
        label: filename.replace(/\.json$/i, ""),
        url: `${DATA_BASE}/mofonaina/${filename}`,
      });
    }
  }

  return missing;
}
