// Lecture automatique fiable des vidéos de FOND (background).
//
// Symptôme corrigé : sur certaines machines Linux (WebKitGTK), la vidéo de fond
// restait figée avec un gros bouton "play" au milieu. Trois causes possibles :
//   1. WebKit exige un geste utilisateur -> play() est rejeté (on retente + on
//      rejoue au premier clic/touche, et lib.rs désactive ce réglage).
//   2. `canplay` n'est jamais émis (pipeline GStreamer lent à démarrer) alors
//      que la vidéo est décodable -> on retente périodiquement.
//   3. Codec absent (H.264 sans gstreamer1.0-libav) -> play() ne marchera
//      jamais : on log l'erreur exacte au lieu de l'avaler silencieusement.

const MEDIA_ERRORS: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED (lecture interrompue)",
  2: "MEDIA_ERR_NETWORK (le serveur média 127.0.0.1:11223 n'a pas répondu)",
  3: "MEDIA_ERR_DECODE (décodage impossible : codec GStreamer manquant ?)",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED (format/codec non supporté ou fichier introuvable)",
};

export function describeVideoError(el: HTMLVideoElement): string {
  const err = el.error;
  if (!err) return "erreur inconnue (pas de MediaError)";
  return `${MEDIA_ERRORS[err.code] ?? `code ${err.code}`}${err.message ? ` — ${err.message}` : ""}`;
}

/**
 * Force la lecture en boucle d'une vidéo de fond et ne lâche pas l'affaire.
 * Retourne une fonction de nettoyage (à appeler au démontage).
 */
export function forceBackgroundPlayback(el: HTMLVideoElement, src: string, label = "Background"): () => void {
  let stopped = false;

  // La source est posée ICI, pas via l'attribut JSX : le nettoyage la retire
  // pour libérer le pipeline GStreamer, et React ne la remettrait jamais (sa
  // valeur n'a pas changé de son point de vue). Avec StrictMode, qui monte les
  // effets deux fois, la vidéo restait alors définitivement vide.
  if (el.getAttribute("src") !== src) {
    el.setAttribute("src", src);
    el.load();
  }

  // Ces propriétés doivent être posées en JS : WebKitGTK ignore parfois les
  // attributs HTML, et `muted` est la condition n°1 de l'autoplay.
  el.muted = true;
  el.defaultMuted = true;
  el.loop = true;
  el.autoplay = true;
  el.playsInline = true;
  el.volume = 0;

  const attempt = () => {
    if (stopped || !el.isConnected) return;
    if (!el.paused && !el.ended) return;
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch((e: unknown) => {
        const name = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.warn(`[${label}] play() refusé -> ${name}`, el.error ? `| ${describeVideoError(el)}` : "");
      });
    }
  };

  // Événements : dès qu'un signal arrive, on (re)tente.
  const events = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough", "playing", "pause", "stalled", "suspend"];
  const onEvent = (ev: Event) => {
    if (ev.type === "pause" && el.ended === false && !stopped) attempt();
    else if (ev.type !== "pause") attempt();
  };
  events.forEach((t) => el.addEventListener(t, onEvent));

  const onError = () => console.error(`[${label}] échec de chargement: ${describeVideoError(el)} | src=${el.currentSrc || el.src}`);
  el.addEventListener("error", onError);

  // Filet de sécurité : WebKit bloque parfois tant qu'aucun geste n'a eu lieu.
  const onGesture = () => attempt();
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);

  // Relance périodique tant que ça ne joue pas (le fond doit tourner en boucle,
  // même si le décodeur met du temps à démarrer).
  const timer = window.setInterval(() => {
    if (stopped) return;
    if (el.paused || el.ended) attempt();
  }, 1000);

  attempt();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    events.forEach((t) => el.removeEventListener(t, onEvent));
    el.removeEventListener("error", onError);
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
    try {
      el.pause();
      el.removeAttribute("src");
      el.load();
    } catch {
      /* GStreamer peut râler au démontage, sans conséquence */
    }
  };
}

/**
 * Libère proprement un élément <video> AVANT son démontage.
 *
 * Sous Linux, détruire un <video> qui est en train de streamer depuis le
 * serveur local laisse WebKitGTK démonter le pipeline GStreamer sur la boucle
 * principale : l'interface se fige plusieurs secondes (parfois plus) au moment
 * de passer à la diapo suivante. Couper la source d'abord rend la destruction
 * quasi instantanée.
 */
export function releaseVideo(el: HTMLVideoElement | null) {
  if (!el) return;
  try {
    el.pause();
    el.removeAttribute("src");
    el.srcObject = null;
    el.load();
  } catch (e) {
    console.warn("releaseVideo:", e);
  }
}
