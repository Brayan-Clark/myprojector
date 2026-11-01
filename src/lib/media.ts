// Centralised media URL resolver.
//
// Local media (backgrounds / imported media / databases) are served by the
// embedded warp server on http://127.0.0.1:11223/fs/<path-relative-to-appdata>.
//
// Historically each component re-implemented this and relied on
// `localStorage.appDataPath`, which is loaded asynchronously at startup. On the
// first renders (or when the stored absolute path didn't exactly match the
// app-data dir) the prefix wasn't stripped and the URL 404'd — that was the
// cause of images "sometimes" not loading. We now derive the relative path from
// the well-known sub-folders so it no longer depends on appDataPath being ready.

/**
 * Adresse du serveur média.
 *
 * ⚠ Le port n'est plus figé. Il l'était, et `warp` PANIQUE si le port est déjà
 * pris : le serveur mourait en silence quand une instance précédente tournait
 * encore, et plus aucun média local ne s'affichait — fond vidéo noir, image
 * importée absente. Le backend choisit maintenant un port libre et le publie
 * ici (voir `media_server_port`).
 *
 * La valeur est lue à chaque appel : la fenêtre de projection est ouverte
 * après que la fenêtre de contrôle l'a enregistrée, et les deux partagent le
 * même `localStorage`.
 */
function mediaServer(): string {
  return `${mediaOrigin()}/fs/`;
}

function mediaOrigin(): string {
  const port = localStorage.getItem("mediaPort") || "11223";
  return `http://127.0.0.1:${port}`;
}

/**
 * URL locale qui relaie une piste distante, par tranches.
 *
 * À préférer au téléchargement complet (`cacheRemoteAudio`) pour une simple
 * écoute : le lecteur reçoit le début du morceau tout de suite au lieu
 * d'attendre les 3 à 15 Mo du fichier entier. Voir `relay_audio` dans
 * `src-tauri/src/lib.rs` pour le détail des en-têtes `Range`.
 *
 * Le relais n'accepte que les hôtes déjà autorisés pour les téléchargements
 * audio : ce n'est pas un proxy générique.
 */
export function audioRelayUrl(remoteUrl: string): string {
  return `${mediaOrigin()}/audio?u=${encodeURIComponent(remoteUrl)}`;
}

// Folders that live directly under the app-data root and are exposed by warp.
const KNOWN_DIRS = ["/backgrounds/", "/media/", "/data/"];

export function cleanUrl(url?: string | null): string | undefined {
  if (!url || url === "null") return undefined;

  // Already a usable URL/scheme — leave untouched.
  if (/^(data:|blob:|asset:|https?:|tauri:)/i.test(url)) return url;

  // Normalise Windows back-slashes so the segment lookup works cross-platform.
  const normalised = url.replace(/\\/g, "/");

  // 1) Preferred: cut the path at a known sub-folder, independent of appDataPath.
  let relative: string | null = null;
  for (const seg of KNOWN_DIRS) {
    const idx = normalised.indexOf(seg);
    if (idx !== -1) {
      relative = normalised.slice(idx + 1); // keep "backgrounds/…"
      break;
    }
  }

  // 2) Fallback: strip the app-data prefix if we happen to have it.
  if (relative === null) {
    const appDataPath = localStorage.getItem("appDataPath");
    relative =
      appDataPath && normalised.startsWith(appDataPath)
        ? normalised.slice(appDataPath.length)
        : normalised;
  }

  const stripped = relative.replace(/^\/+/, "");
  // Encode each segment individually so spaces / accents / "#" / "?" in file
  // names are escaped while the path separators are preserved.
  const encoded = stripped.split("/").map(encodeURIComponent).join("/");
  return mediaServer() + encoded;
}
