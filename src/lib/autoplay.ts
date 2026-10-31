// Lecture automatique fiable des vidéos de FOND (background).
//
// Symptôme corrigé : sur certaines machines Linux (WebKitGTK), la vidéo de fond
// restait figée avec un gros bouton "play" au milieu. Cinq causes possibles :
//   1. WebKit exige un geste utilisateur -> play() est rejeté (on retente + on
//      rejoue au premier clic/touche, et lib.rs désactive ce réglage).
//   2. `canplay` n'est jamais émis (pipeline GStreamer lent à démarrer) alors
//      que la vidéo est décodable -> on retente périodiquement.
//   3. Codec absent (H.264 sans gstreamer1.0-libav) -> play() ne marchera
//      jamais : on log l'erreur exacte au lieu de l'avaler silencieusement.
//   4. Le serveur média local n'était pas encore prêt -> l'élément part en
//      erreur et y reste. `play()` n'en sort pas : il faut RECHARGER.
//   5. Le pipeline cale en cours de route -> l'élément se dit « en lecture »
//      mais aucune image ne sort. Seul le suivi de `currentTime` le détecte.
//
// Les deux dernières sont traitées par la surveillance en bas de
// `forceBackgroundPlayback` : c'est elle qui explique les démarrages ratés
// « de temps en temps », sans cause apparente.

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
        const detail = `${label} play() refusé -> ${name}${el.error ? ` | ${describeVideoError(el)}` : ""}`
          + ` | muted=${el.muted} readyState=${el.readyState} src=${(el.currentSrc || "").slice(-40)}`;
        console.warn(detail);
        // Remonté au terminal : sans ça, l'échec reste invisible dans la
        // fenêtre de projection, qui n'a pas de console accessible.
        import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("debug_log", { message: detail }))
          .catch(() => {});
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

  // --- Surveillance : relancer, et si besoin RECHARGER ---------------------
  //
  // Relancer ne suffit pas. `play()` ne répare pas deux situations pourtant
  // courantes, et c'est ce qui faisait qu'un fond vidéo « ne démarrait pas,
  // parfois » :
  //
  //   a) L'élément est en ERREUR. Au lancement, le serveur média local
  //      (127.0.0.1:11223) n'est pas toujours prêt à la milliseconde où la
  //      fenêtre de projection s'ouvre : la requête échoue, `error` est émis,
  //      et l'élément reste définitivement cassé. `play()` sur un élément en
  //      erreur ne fait rien — il faut relire la source.
  //
  //   b) L'élément se dit EN LECTURE mais rien n'avance. Le pipeline GStreamer
  //      a calé : `paused` vaut false, donc l'ancienne surveillance considérait
  //      que tout allait bien et ne retentait jamais. À l'écran, une image fixe.
  //
  // On suit donc la progression réelle de `currentTime`. Le rechargement est
  // plafonné : si le codec manque (H.264 sans gstreamer1.0-libav), recharger en
  // boucle ne ferait que consommer le processeur pendant le culte.
  const MAX_RELOADS = 5;
  const STALL_TICKS = 3; // ~3 s sans la moindre image avant de réagir
  let lastTime = -1;
  let stalledTicks = 0;
  let reloads = 0;

  const reload = (why: string) => {
    if (reloads >= MAX_RELOADS) return;
    reloads++;
    console.warn(`[${label}] ${why} -> rechargement ${reloads}/${MAX_RELOADS}`,
      el.error ? `| ${describeVideoError(el)}` : "");
    try {
      el.removeAttribute("src");
      el.load();           // coupe le pipeline en cours (cf. releaseVideo)
      el.setAttribute("src", src);
      el.load();
    } catch (e) {
      console.warn(`[${label}] rechargement impossible:`, e);
    }
    attempt();
  };

  const timer = window.setInterval(() => {
    if (stopped || !el.isConnected) return;

    if (el.error) {
      reload("élément en erreur");
      return;
    }
    if (el.paused || el.ended) {
      attempt();
      return;
    }

    // Se dit en lecture : vérifier que des images sortent vraiment.
    if (el.currentTime === lastTime) {
      if (++stalledTicks >= STALL_TICKS) {
        stalledTicks = 0;
        reload("lecture figée (aucune image depuis 3 s)");
      }
    } else {
      // Ça tourne : on repart de zéro, y compris le compteur de
      // rechargements, pour qu'un incident tardif reste rattrapable.
      lastTime = el.currentTime;
      stalledTicks = 0;
      reloads = 0;
    }
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
