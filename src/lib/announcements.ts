// Annonces qui défilent sur l'écran d'accueil.
//
// Avant le culte, l'écran affiche un fond fixe pendant que l'assemblée
// s'installe. C'est le seul moment où tout le monde regarde l'écran sans que
// rien n'y soit écrit : autant y faire passer les annonces de la semaine.
//
// DÉSACTIVÉ par défaut. Activé, cela ne remplace que l'écran d'accueil —
// jamais un chant ou un verset en cours de projection.

export type Announcements = {
  enabled: boolean;
  /** Secondes d'affichage de chaque annonce. */
  interval: number;
  /** Texte brut, les annonces étant séparées par une ligne `---`. */
  text: string;
};

export const DEFAULT_ANNOUNCEMENTS: Announcements = {
  enabled: false,
  interval: 10,
  text: "",
};

export function withAnnouncementDefaults(a?: Partial<Announcements> | null): Announcements {
  const merged = { ...DEFAULT_ANNOUNCEMENTS, ...(a || {}) };
  // Moins de 3 s, personne n'a le temps de lire ; plus de 2 min, l'écran
  // semble figé et on croit à une panne.
  merged.interval = Math.min(120, Math.max(3, merged.interval));
  return merged;
}

/**
 * Annonces individuelles.
 *
 * Le séparateur `---` est le même que pour les diapos Markdown de l'agenda :
 * une convention de moins à retenir.
 */
export function announcementSlides(a?: Partial<Announcements> | null): string[] {
  const { text } = withAnnouncementDefaults(a);
  return text
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
