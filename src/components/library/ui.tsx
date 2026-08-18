import type { ReactNode } from "react";
import { Check, Download, Loader2, Trash2 } from "lucide-react";
import type { Progress } from "./useLibrary";

/** Barre de progression d'un téléchargement en cours. */
export function ProgressBar({ p }: { p: Progress }) {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : null;
  return (
    <div className="w-full">
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full bg-[#5865f2] transition-[width] duration-200 ${pct === null ? "animate-pulse w-1/3" : ""}`}
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
        <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400 border border-emerald-500/20">
          <Check size={11} /> {compact ? "" : "Installé"}
        </span>
        <button
          onClick={onRemove}
          title="Supprimer du disque"
          className="rounded p-1.5 text-gray-500 transition hover:bg-red-500/15 hover:text-red-400"
        >
          <Trash2 size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onInstall}
      className="flex items-center gap-1.5 rounded bg-[#5865f2] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#4752c4]"
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

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-lg border border-red-500/20 bg-red-500/10 p-6 text-center">
      <p className="text-sm font-bold text-red-400">{message}</p>
      <p className="text-[11px] text-gray-400">
        Ces contenus se téléchargent depuis Internet. Vérifie ta connexion — l'application
        fonctionne normalement sans eux.
      </p>
      <button onClick={onRetry} className="rounded bg-red-600 px-4 py-2 text-[11px] font-bold text-white transition hover:bg-red-500">
        Réessayer
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-24 text-center text-sm text-gray-500">{children}</div>;
}

/** Fiche générique de la grille. */
export function Card({
  accent, eyebrow, title, meta, actions, onOpen,
}: {
  accent: string;
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
  actions: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-white/5 bg-[#232428] transition hover:border-[#5865f2]/50 hover:bg-[#26272b]">
      <div
        className="h-1.5 w-full shrink-0"
        style={{ background: accent }}
      />
      <div className="flex flex-1 flex-col gap-2 p-4">
        {eyebrow && (
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
            {eyebrow}
          </p>
        )}
        <h3
          className={`text-sm font-semibold leading-snug text-gray-100 ${onOpen ? "cursor-pointer hover:text-white" : ""}`}
          onClick={onOpen}
          title={title}
        >
          {title}
        </h3>
        {meta && <div className="text-[11px] text-gray-500">{meta}</div>}
        <div className="mt-auto pt-3">{actions}</div>
      </div>
    </div>
  );
}
