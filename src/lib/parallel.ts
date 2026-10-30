// Affichage de plusieurs versions bibliques sur la même diapo.
//
// Le besoin : une assemblée mélangée. Projeter le verset en malgache ET en
// français évite de choisir — et sert aussi pour une lecture comparée.
//
// Le nombre de versions est libre, mais chacune prend de la place : au-delà de
// trois, le texte devient trop petit pour le fond de la salle. L'interface le
// dit au lieu de l'interdire — c'est l'opérateur qui voit la salle.

export type ParallelSettings = {
  /** Fichiers des versions SUPPLÉMENTAIRES (la principale est celle chargée). */
  versions: string[];
  /** Taille des versions secondaires, en % de la taille du texte principal. */
  sizeFactor: number;
  /** Préfixer chaque version par le nom du livre dans sa langue. */
  showBookName: boolean;
};

export const DEFAULT_PARALLEL: ParallelSettings = {
  versions: [],
  sizeFactor: 70,
  showBookName: false,
};

/** Au-delà, le texte devient illisible depuis le fond de la salle. */
export const COMFORTABLE_VERSIONS = 2;

export function withParallelDefaults(p?: Partial<ParallelSettings> | null): ParallelSettings {
  const merged = { ...DEFAULT_PARALLEL, ...(p || {}) };
  return {
    ...merged,
    versions: Array.isArray(merged.versions) ? merged.versions : [],
    sizeFactor: Math.min(100, Math.max(30, merged.sizeFactor)),
  };
}

/** Nom lisible d'un fichier de version (« MG65.SQLite3 » → « MG65 »). */
export function versionLabel(file: string): string {
  const base = file.replace(/\.(SQLite3|db)$/i, "");
  const known: Record<string, string> = {
    MG65: "Malagasy (MG1965)",
    DIEM: "Malagasy (DIEM)",
    SBF: "Malagasy (SBF)",
    Louis_Segond: "Français (Segond)",
    Ostervald: "Français (Ostervald)",
    BDS: "Français (Semeur)",
    S21: "Français (Segond 21)",
    KJV: "English (KJV)",
    NVI: "English (NVI)",
  };
  return known[base] || base.replace(/_/g, " ");
}
