// Entête de projection : la référence affichée par-dessus la diapo
// (« Jean 3:16 », ou le titre du cantique).
//
// Elle était écrite en dur dans LiveView :
//   isBible ? 'top-8 right-12 text-4xl' : 'bottom-4 ... text-white/60'
// Trois conséquences, toutes rencontrées :
//   1. En haut à droite… exactement là où l'horloge se place par défaut. Les
//      deux se superposaient.
//   2. En bas, elle passait sous le bandeau de message défilant.
//   3. Ni la taille, ni la police, ni la couleur ne suivaient les réglages, et
//      le mini-moniteur de contrôle ne l'affichait pas du tout — on ne voyait
//      le problème qu'une fois projeté devant l'assemblée.

export type HeaderPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** Ce que l'entête raconte. Dépend du type de contenu projeté. */
export type HeaderContent = "ref" | "ref-version" | "full";

export type HeaderSettings = {
  enabled: boolean;
  position: HeaderPosition;
  /** Dixièmes de pourcent de la hauteur d'écran : 30 → 3 % (≈ 32 px en 1080p). */
  size: number;
  fontFamily: string;
  color: string;
  isBold: boolean;
  /** Pastille derrière le texte : 0 = aucune. */
  bgOpacity: number;
  bgColor: string;
  content: HeaderContent;
};

export const DEFAULT_HEADER: HeaderSettings = {
  enabled: true,
  position: "top-right",
  size: 30,
  fontFamily: "Inter",
  color: "#ffffff",
  isBold: true,
  bgOpacity: 0,
  bgColor: "#000000",
  content: "ref",
};

export const HEADER_PRESETS: { label: string; hint: string; value: Partial<HeaderSettings> }[] = [
  {
    label: "Discret",
    hint: "Petit, en bas à droite",
    value: { position: "bottom-right", size: 18, isBold: false, bgOpacity: 0, color: "#ffffff" },
  },
  {
    label: "Classique",
    hint: "En haut à droite, lisible",
    value: { position: "top-right", size: 30, isBold: true, bgOpacity: 0, color: "#ffffff" },
  },
  {
    label: "Pastille",
    hint: "Sur un fond semi-opaque",
    value: { position: "top-left", size: 26, isBold: true, bgOpacity: 55, bgColor: "#000000" },
  },
];

export function withHeaderDefaults(h?: Partial<HeaderSettings> | null): HeaderSettings {
  return { ...DEFAULT_HEADER, ...(h || {}) };
}

/**
 * Décale l'entête pour qu'elle ne chevauche ni l'horloge ni le bandeau.
 *
 * Renvoie un décalage en pourcentage de la hauteur d'écran : la projection et
 * le mini-moniteur l'appliquent chacun à leur échelle, donc l'aperçu montre
 * bien le même évitement.
 */
export function headerOffsetPercent(
  header: HeaderSettings,
  clock?: { enabled?: boolean; position?: string; size?: number; type?: string } | null,
  ticker?: { enabled?: boolean; position?: string; fontSize?: number } | null
): number {
  const isTop = header.position.startsWith("top");
  let offset = 0;

  // L'horloge n'occupe qu'un coin : seul le même coin pose problème.
  // Une horloge analogique fait deux rayons de haut, d'où le facteur.
  if (clock?.enabled && clock.position === header.position) {
    const px = (clock.size || 60) * (clock.type === "analog" ? 2 : 1);
    offset += (px / 1080) * 100 + 2;
  }

  // Le bandeau, lui, barre toute la largeur : il gêne les trois positions du
  // bord concerné.
  if (ticker?.enabled && (isTop ? ticker.position === "top" : ticker.position !== "top")) {
    offset += ((ticker.fontSize || 28) / 1080) * 100 + 4;
  }

  return offset;
}

/**
 * Texte de l'entête, selon le contenu projeté et le réglage choisi.
 * `verse` n'est renseigné que pour la Bible (premier verset de la diapo).
 */
export function buildHeaderText(
  header: HeaderSettings,
  song: { title?: string; number?: string; version?: string | null } | null,
  isBible: boolean,
  verse?: string | null
): string {
  if (!song?.title) return "";
  if (isBible) {
    const base = verse ? `${song.title}:${verse}` : song.title;
    if (header.content === "ref") return base;
    const version = (song.version || "").replace(/\.(SQLite3|db)$/i, "");
    return version ? `${base} · ${version}` : base;
  }
  // Un cantique : le numéro n'est utile que si on le demande — projeté seul,
  // un titre suffit à l'assemblée qui chante.
  if (header.content === "full" && song.number) return `${song.number} — ${song.title}`;
  return song.title;
}
