// Reprise après incident.
//
// Le cas réel : l'application s'arrête en plein culte — plantage, coupure de
// courant, fermeture par erreur. L'agenda, lui, était déjà conservé ; la
// POSITION ne l'était pas. Au redémarrage l'opérateur retrouvait sa liste mais
// devait se rappeler où il en était, rouvrir le bon élément et recompter les
// strophes, devant l'assemblée qui attend.
//
// ⚠ On ne reprojette JAMAIS tout seul.
//
// Rétablir automatiquement l'affichage enverrait du contenu sur l'écran de la
// salle sans que personne ne l'ait demandé — par exemple au lendemain, pendant
// une réunion qui n'a rien à voir. La position est donc PROPOSÉE, et c'est
// l'opérateur qui décide.

/** Ce qu'il faut pour retrouver une position de projection. */
export interface ResumePoint {
  /** Identifiant de l'élément d'agenda projeté. */
  itemId: string;
  /** Titre au moment de l'enregistrement, pour pouvoir le proposer. */
  title: string;
  /** Index de diapo. */
  slideIndex: number;
  /** Page courante, pour un PDF. */
  pdfPage: number;
  /** Horodatage ISO de l'enregistrement. */
  savedAt: string;
}

const KEY = "resumePoint";

/**
 * Au-delà de ce délai, la proposition disparaît.
 *
 * Douze heures couvrent un culte interrompu et repris le même jour, sans
 * proposer la semaine suivante de reprendre un cantique de la semaine
 * précédente — ce qui serait au mieux déroutant.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function saveResumePoint(point: Omit<ResumePoint, "savedAt">): void {
  try {
    const full: ResumePoint = { ...point, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    // Un stockage plein ne doit pas interrompre une projection en cours.
  }
}

export function clearResumePoint(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* sans conséquence */
  }
}

/**
 * Position enregistrée, si elle est encore pertinente.
 *
 * `knownIds` est l'ensemble des éléments présents dans l'agenda restauré : une
 * position qui désigne un élément supprimé depuis n'a plus de sens, et la
 * proposer mènerait à un clic sans effet.
 */
export function readResumePoint(knownIds: Iterable<string>): ResumePoint | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const point = JSON.parse(raw) as ResumePoint;
    if (
      !point ||
      typeof point.itemId !== "string" ||
      typeof point.slideIndex !== "number" ||
      !point.savedAt
    ) {
      return null;
    }

    const age = Date.now() - new Date(point.savedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;

    if (!new Set(knownIds).has(point.itemId)) return null;

    return point;
  } catch {
    return null;
  }
}

/** « il y a 12 minutes », pour que l'opérateur sache de quoi on parle. */
export function describeAge(savedAt: string): string {
  const ms = Date.now() - new Date(savedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "à l'instant";
  // `floor`, pas `round` : à 30 secondes, « il y a 1 min » est faux, et
  // « à l'instant » est exactement ce que l'opérateur a en tête.
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `il y a ${hours} h`;
}
