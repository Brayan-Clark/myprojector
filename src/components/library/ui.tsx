import type { ReactNode } from "react";
import { Check, Download, Inbox, Loader2, Trash2, WifiOff } from "lucide-react";
import type { Progress } from "./useLibrary";

/**
 * Briques visuelles de la bibliothèque.
 *
 * Elles sont réunies ici pour une raison concrète : la bibliothèque compte
 * treize sections écrites à des moments différents, et chacune redessinait ses
 * propres cartes, ses propres boutons et ses propres états de chargement. Le
 * résultat se voyait — trois gris de fond, deux tailles de titre, des
 * arrondis différents d'un onglet à l'autre. Toute nouvelle section doit
 * composer avec ce qui suit plutôt que réinventer.
 */

/** Barre de progression d'un téléchargement en cours. */
export function ProgressBar({ p }: { p: Progress }) {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : null;
  return (
    <div className="w-full">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full bg-gradient-to-r from-[#5865f2] to-[#8891f2] transition-[width] duration-200 ${
            pct === null ? "w-1/3 animate-pulse" : ""
          }`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] tabular-nums text-gray-400">
        {pct === null ? "Téléchargement…" : `${pct} %`}
      </p>
    </div>
  );
}

/** Bouton d'action principal d'une fiche : installer / installé / en cours. */
export function InstallButton({
  installed, progress, onInstall, onRemove, compact = false,
}: {
  installed: boolean;
  progress?: Progress;
  onInstall: () => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  if (progress) return <ProgressBar p={progress} />;

  if (installed) {
    return (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
          <Check size={11} /> {compact ? "" : "Installé"}
        </span>
        <button
          onClick={onRemove}
          title="Supprimer du disque"
          className="rounded-md p-1.5 text-gray-500 transition hover:bg-red-500/15 hover:text-red-400"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onInstall}
      className="flex items-center gap-1.5 rounded-md bg-[#5865f2] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm shadow-[#5865f2]/25 transition hover:bg-[#4752c4]"
    >
      <Download size={13} /> Télécharger
    </button>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-gray-500">
      <Loader2 size={28} className="animate-spin text-[#5865f2]" />
      <p className="text-xs font-bold uppercase tracking-widest">{label}</p>
    </div>
  );
}

/**
 * Attente qui ressemble au contenu à venir.
 *
 * Préférable au `Spinner` quand on sait déjà que le résultat sera une grille :
 * la mise en page ne saute pas au moment où les données arrivent.
 */
export function SkeletonGrid({ count = 8, min = 250 }: { count?: number; min?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-xl border border-white/5 bg-[#232428]">
          <div className="h-1 w-full bg-white/10" />
          <div className="space-y-2.5 p-4">
            <div className="h-2 w-1/3 rounded bg-white/10" />
            <div className="h-3 w-4/5 rounded bg-white/10" />
            <div className="h-2 w-1/2 rounded bg-white/5" />
            <div className="mt-4 h-7 w-28 rounded-md bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center">
      <p className="text-sm font-bold text-red-400">{message}</p>
      <p className="text-[11px] leading-relaxed text-gray-400">
        Ces contenus se téléchargent depuis Internet. Vérifie ta connexion — l'application
        fonctionne normalement sans eux.
      </p>
      <button onClick={onRetry} className="rounded-md bg-red-600 px-4 py-2 text-[11px] font-bold text-white transition hover:bg-red-500">
        Réessayer
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="col-span-full flex flex-col items-center gap-3 py-24 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/5">
        <Inbox size={18} className="text-gray-600" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-gray-500">{children}</p>
    </div>
  );
}

/** Pastille d'état posée en haut d'une fiche (« En cours », « Nouveau »…). */
export function Badge({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
      style={{
        color: accent || "#8891f2",
        background: `color-mix(in srgb, ${accent || "#5865f2"} 18%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

/** Bouton de filtre arrondi, partagé par les sections qui filtrent une liste. */
export function FilterPill({
  active, onClick, children, tone = "indigo",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: "indigo" | "amber";
}) {
  const on = tone === "amber"
    ? "border-transparent bg-amber-500 text-black"
    : "border-transparent bg-[#5865f2] text-white";
  const off = tone === "amber"
    ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
    : "border-white/10 text-gray-400 hover:border-white/25 hover:text-gray-200";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition ${active ? on : off}`}
    >
      {children}
    </button>
  );
}

/**
 * En-tête d'une vue imbriquée : bouton de retour, titre, sous-titre, actions.
 *
 * Trois sections avaient leur propre version de cette rangée, avec trois
 * alignements différents. Les ouvrir l'une après l'autre donnait l'impression
 * de changer de logiciel.
 */
export function DetailHeader({
  onBack, backLabel = "Retour", title, subtitle, children,
}: {
  onBack: () => void;
  backLabel?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={onBack}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-[11px] font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
        </svg>
        {backLabel}
      </button>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-white">{title}</h3>
        {subtitle && <p className="truncate text-[11px] text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Fiche générique de la grille. */
export function Card({
  accent, eyebrow, title, meta, actions, onOpen, badge, cover, description,
}: {
  accent: string;
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
  actions: ReactNode;
  onOpen?: () => void;
  /** Pastille d'état, affichée à droite de l'exergue. */
  badge?: string;
  /** Visuel de couverture (trimestre de l'École du Sabbat, par exemple). */
  cover?: string;
  description?: string;
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/5 bg-[#232428] transition hover:border-[#5865f2]/50 hover:bg-[#26272b]">
      {cover ? (
        <button
          onClick={onOpen}
          disabled={!onOpen}
          className="relative block aspect-[3/4] w-full shrink-0 overflow-hidden bg-black/40 disabled:cursor-default"
        >
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
          {badge && (
            <span className="absolute left-2 top-2">
              <Badge accent={accent}>{badge}</Badge>
            </span>
          )}
        </button>
      ) : (
        <div className="h-1 w-full shrink-0" style={{ background: accent }} />
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        {(eyebrow || (badge && !cover)) && (
          <div className="flex items-center gap-2">
            {eyebrow && (
              <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
                {eyebrow}
              </p>
            )}
            {badge && !cover && <Badge accent={accent}>{badge}</Badge>}
          </div>
        )}
        <h3
          className={`text-sm font-semibold leading-snug text-gray-100 ${onOpen ? "cursor-pointer hover:text-white" : ""}`}
          onClick={onOpen}
          title={title}
        >
          {title}
        </h3>
        {description && (
          <p className="line-clamp-3 text-[11px] leading-relaxed text-gray-500">{description}</p>
        )}
        {meta && <div className="text-[11px] text-gray-500">{meta}</div>}
        <div className="mt-auto pt-3">{actions}</div>
      </div>
    </div>
  );
}

/**
 * Bandeau "mode hors ligne".
 *
 * Affiché quand le catalogue distant est injoignable et qu'on travaille sur la
 * dernière copie connue. Volontairement discret et non bloquant : tout ce qui
 * est déjà sur le disque reste utilisable, seuls les nouveaux téléchargements
 * sont impossibles.
 */
export function OfflineNotice({ detail, onRetry }: { detail?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-300">
      <WifiOff size={13} className="shrink-0" />
      <span className="font-semibold">Mode hors ligne</span>
      <span className="text-amber-300/70">
        {detail || "Catalogue injoignable — affichage de la dernière liste connue. Les contenus déjà téléchargés restent utilisables."}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-auto rounded-md border border-amber-500/40 px-2 py-1 font-bold transition hover:bg-amber-500/15"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
