// Accès aux contenus téléchargeables du dépôt Brayan-Clark/adventools (branche
// `data`). Tout est optionnel : rien n'est téléchargé sans action explicite de
// l'utilisateur, et l'application fonctionne entièrement sans.

import { invoke } from "@tauri-apps/api/core";

export const DATA_BASE =
  "https://raw.githubusercontent.com/Brayan-Clark/adventools/data";

export type LibraryKind = "docs" | "mofonaina" | "audio";

export interface DocCategory { id: string; title: string; icon?: string; color?: string; bg?: string }
export interface DocDepartment { id: string; translations: Record<string, string> }
export interface DocItem {
  id: string;
  title: string;
  fileName: string;
  categoryId: string;
  url: string;
  size: string;
  tags?: string[];
}
export interface DocsManifest {
  departments: DocDepartment[];
  categories: DocCategory[];
  documents: DocItem[];
}

export interface PlaybackCollection {
  id: string;
  title: string;
  lang?: string;
  count?: number;
  color?: string;
}
export interface PlaybackTrack {
  id: string;
  /** Numéro du cantique dans le recueil — c'est LUI qui fait le lien, pas `id`. */
  c_num?: string;
  title: string;
  url: string;
}

export interface Meditation {
  date: string;
  titre_du_jour: string;
  verset_texte: string;
  verset_reference: string;
  contenu: string;
}
export interface MofonainaFile {
  trimestre: { annee: number; numero_trimestre: number; titre_principal: string };
  meditations: Meditation[];
}

export interface LibraryFile { filename: string; path: string; size: number }

/**
 * Catalogue distant, avec repli hors ligne.
 *
 * `stale: true` signifie que la connexion a échoué et qu'on ressert la dernière
 * copie reçue. Sans ce repli, une coupure réseau masquait aussi les contenus
 * déjà téléchargés : la bibliothèque devenait entièrement inutilisable hors
 * ligne, alors que les fichiers étaient bien sur le disque.
 */
export interface Cached<T> { data: T; stale: boolean }

/** Une clé de cache sert de nom de fichier côté Rust : slug uniquement. */
const cacheKey = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/\.+/g, ".");

async function getJson<T>(path: string, key: string): Promise<Cached<T>> {
  try {
    // Cache-buster : GitHub sert les manifestes via un CDN qui garde longtemps
    // les anciennes versions.
    const res = await fetch(`${DATA_BASE}/${path}?c=${Date.now()}`);
    if (!res.ok) throw new Error(`${path} : HTTP ${res.status}`);
    const text = await res.text();
    const data = JSON.parse(text) as T;
    // Mise en cache au fil de l'eau : le prochain démarrage hors ligne s'en sert.
    invoke("cache_manifest", { key, contents: text }).catch((e) =>
      console.warn("Mise en cache du catalogue impossible", key, e)
    );
    return { data, stale: false };
  } catch (e) {
    const cached = await readCache(key);
    if (cached !== null) return { data: JSON.parse(cached) as T, stale: true };
    throw e;
  }
}

const readCache = (key: string) =>
  invoke<string | null>("read_cached_manifest", { key }).catch(() => null);

export const fetchDocsManifest = () =>
  getJson<DocsManifest>("docs/manifest.json", "docs-manifest");

export const fetchPlaybackCollections = () =>
  getJson<PlaybackCollection[]>("audio/playbacks/manifest.json", "audio-collections");

export const fetchPlaybackTracks = (id: string) =>
  getJson<PlaybackTrack[]>(`audio/playbacks/${id}.json`, cacheKey(`audio-tracks-${id}`));

/**
 * Trimestres Mofon'aina disponibles (listés côté Rust : l'API GitHub n'est pas
 * autorisée par la CSP). Même repli hors ligne que les autres catalogues.
 */
export async function fetchMofonainaFiles(): Promise<Cached<string[]>> {
  const key = "mofonaina-index";
  try {
    const data = await invoke<string[]>("list_remote_mofonaina");
    invoke("cache_manifest", { key, contents: JSON.stringify(data) }).catch(() => {});
    return { data, stale: false };
  } catch (e) {
    const cached = await readCache(key);
    if (cached !== null) return { data: JSON.parse(cached) as string[], stale: true };
    throw e;
  }
}

export const listInstalled = (kind: LibraryKind, collection?: string) =>
  invoke<LibraryFile[]>("list_library_files", { kind, collection: collection ?? null });

export const removeInstalled = (kind: LibraryKind, filename: string, collection?: string) =>
  invoke<void>("delete_library_file", { kind, filename, collection: collection ?? null });

export const downloadFile = (
  args: { url: string; kind: LibraryKind; filename: string; id: string; collection?: string }
) => invoke<string>("download_library_file", { ...args, collection: args.collection ?? null });

export const readInstalledJson = (kind: LibraryKind, filename: string) =>
  invoke<string>("read_library_json", { kind, filename });

/** Nom de fichier local d'un document : préfixé par son id pour éviter toute
 *  collision entre catégories (plusieurs "Ifm.pdf" existent dans le dépôt). */
export function docFileName(doc: DocItem): string {
  const base = decodeURIComponent(doc.url.split("/").pop() || "document.pdf");
  return `${doc.id}-${base}`.replace(/[/\\]/g, "-");
}

/** Nom de fichier local d'une piste : le numéro de cantique, pour retrouver
 *  l'audio d'un chant sans relire le manifeste distant. */
export function trackFileName(track: PlaybackTrack): string {
  const num = (track.c_num || track.id || "").toString().trim();
  return `${num}.mp3`;
}

export function formatBytes(n: number): string {
  if (n <= 0) return "—";
  const mo = n / (1024 * 1024);
  return mo >= 1 ? `${mo.toFixed(1)} Mo` : `${Math.round(n / 1024)} Ko`;
}

/** Découpe une méditation en "versets" projetables (un paragraphe par écran). */
export function meditationToLyrics(m: Meditation): string {
  const parts = [
    `${m.verset_texte}\n(${m.verset_reference})`,
    ...m.contenu.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
  ];
  return parts.join("\n\n");
}

/**
 * Retrouve la piste audio d'un cantique.
 * Le lien se fait par `c_num` (le numéro du chant), PAS par `id` : dans
 * fihirana-adventista l'entrée id=300 correspond au cantique n°324.
 */
export async function resolveHymnAudio(
  collection: string,
  number: string
): Promise<PlaybackTrack | null> {
  const { data: tracks } = await fetchPlaybackTracks(collection);
  const n = String(number).trim();
  return tracks.find((t) => String(t.c_num ?? t.id).trim() === n) || null;
}

/**
 * Piste déjà téléchargée pour un cantique, SANS toucher au réseau.
 *
 * Le nom de fichier local est `<numéro>.mp3` : on retrouve donc l'audio d'un
 * chant sans le catalogue distant. C'est ce qui permet d'ajouter un playback à
 * l'agenda hors ligne, alors qu'avant l'échec du manifeste faisait croire que
 * le fichier n'existait pas.
 */
export async function localHymnAudio(
  collection: string,
  number: string
): Promise<{ path: string; filename: string } | null> {
  const filename = `${String(number).trim()}.mp3`;
  const files = await listInstalled("audio", collection).catch(() => [] as LibraryFile[]);
  const found = files.find((f) => f.filename === filename);
  return found ? { path: found.path, filename } : null;
}

/** Source lisible d'une piste : le fichier local s'il existe, sinon le flux en ligne. */
export async function hymnAudioSource(
  collection: string,
  track: PlaybackTrack
): Promise<{ src: string; offline: boolean }> {
  try {
    const files = await listInstalled("audio", collection);
    const local = files.find((f) => f.filename === trackFileName(track));
    if (local) {
      const { cleanUrl } = await import("./media");
      const url = cleanUrl(local.path);
      if (url) return { src: url, offline: true };
    }
  } catch (e) {
    console.warn("hymnAudioSource: lecture locale impossible", e);
  }
  return { src: track.url, offline: false };
}

/** Dossier de cache des écoutes en ligne, distinct des vrais téléchargements. */
export const AUDIO_CACHE = "_cache";

/**
 * Prépare une écoute en ligne et renvoie une URL LOCALE lisible.
 *
 * Le fichier est déposé dans un cache puis servi par le serveur local, au lieu
 * d'être lu depuis un `blob:`. C'est le chemin déjà utilisé par les audios
 * téléchargés, et c'est le seul qui démarre réellement à 0:00 : sur une source
 * blob, WebKitGTK ne dispose pas d'un flux positionnable et la lecture pouvait
 * commencer en plein milieu du morceau.
 *
 * Bénéfice secondaire : la barre de progression devient fiable, puisque le
 * serveur local gère les requêtes Range.
 */
export async function cacheRemoteAudio(url: string, cacheName: string): Promise<string> {
  const filename = cacheName.replace(/[/\\]/g, "-");
  const files = await listInstalled("audio", AUDIO_CACHE).catch(() => []);
  const existing = files.find((f) => f.filename === filename);
  const path = existing
    ? existing.path
    : await downloadFile({
        url, kind: "audio", filename,
        id: `cache:${filename}`, collection: AUDIO_CACHE,
      });
  const { cleanUrl } = await import("./media");
  const local = cleanUrl(path);
  if (!local) throw new Error("Chemin de cache illisible");
  return local;
}
