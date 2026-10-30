// Écran retour : un troisième affichage, tourné vers l'estrade.
//
// Ce que voit l'assemblée ne convient pas aux musiciens : il leur faut la
// strophe EN COURS, celle qui ARRIVE, et l'heure. Le prédicateur, lui, veut
// surtout savoir depuis combien de temps il parle.
//
// ⚠ Rien n'est ouvert par défaut. L'application reste à deux fenêtres tant
// qu'on n'a pas demandé la troisième : une église sur deux n'a pas d'écran de
// retour, et personne ne doit subir une fenêtre dont il n'a pas l'usage.

export type StageSettings = {
  showCurrent: boolean;
  showNext: boolean;
  showClock: boolean;
  showTimer: boolean;
  /** Taille du texte en cours, en % (le « suivant » s'affiche plus petit). */
  fontSize: number;
};

export const DEFAULT_STAGE: StageSettings = {
  showCurrent: true,
  showNext: true,
  showClock: true,
  showTimer: false,
  fontSize: 100,
};

export function withStageDefaults(s?: Partial<StageSettings> | null): StageSettings {
  const merged = { ...DEFAULT_STAGE, ...(s || {}) };
  merged.fontSize = Math.min(200, Math.max(40, merged.fontSize));
  return merged;
}

/** Durée écoulée, formatée `m:ss` ou `h:mm:ss`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
