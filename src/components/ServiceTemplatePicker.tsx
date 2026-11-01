import { useMemo, useState } from "react";
import {
  BookMarked, Check, Clock, Copy, GripVertical, HandHeart, Plus, Save,
  Sparkles, Sunset, Trash2, Users, Wine, X,
} from "lucide-react";
import {
  allTemplates, deleteUserTemplate, duplicateTemplate, formatDuration,
  saveUserTemplate, templateItems, totalMinutes,
  type ServiceTemplate, type TemplateKind, type TemplateStep,
} from "../lib/serviceTemplates";
import type { PlaylistItem } from "../lib/items";

/**
 * Identité visuelle de chaque famille de service.
 *
 * ⚠ Aucune photographie n'est embarquée, et c'est un choix.
 *
 * Des images de culte seraient soit sous licence (un risque juridique pour une
 * application distribuée aux églises), soit des banques d'images génériques qui
 * ne ressemblent à aucune assemblée réelle. Une identité construite — dégradé,
 * icône, couleur — tient la même promesse visuelle, pèse zéro octet, et reste
 * nette sur un vidéoprojecteur comme sur un écran 1080p. Un fond photo peut
 * toujours être ajouté par l'opérateur, qui a les images de SON église.
 */
const KINDS: Record<TemplateKind, { icon: any; from: string; to: string; accent: string }> = {
  divine:    { icon: BookMarked, from: "#4f46e5", to: "#7c3aed", accent: "#8891f2" },
  study:     { icon: Sparkles,   from: "#b45309", to: "#f59e0b", accent: "#fbbf24" },
  youth:     { icon: Users,      from: "#0e7490", to: "#06b6d4", accent: "#22d3ee" },
  prayer:    { icon: HandHeart,  from: "#065f46", to: "#10b981", accent: "#34d399" },
  vespers:   { icon: Sunset,     from: "#9a3412", to: "#f97316", accent: "#fb923c" },
  communion: { icon: Wine,       from: "#881337", to: "#e11d48", accent: "#fb7185" },
};

/**
 * Sélecteur de déroulé de culte.
 *
 * Trois choses à la fois, parce qu'elles vont ensemble : CHOISIR un modèle,
 * VOIR ce qu'il contient avant de l'insérer, et le MODIFIER pour en faire
 * celui de son église. Un modèle qu'on ne peut pas inspecter avant de
 * l'appliquer demande de l'annuler pour comprendre ; un modèle qu'on ne peut
 * pas modifier finit par ne plus être utilisé.
 */
export function ServiceTemplatePicker({ onClose, onApply }: {
  onClose: () => void;
  onApply: (template: ServiceTemplate, items: PlaylistItem[]) => void;
}) {
  const [templates, setTemplates] = useState<ServiceTemplate[]>(() => allTemplates());
  const [selectedId, setSelectedId] = useState<string>(() => allTemplates()[0]?.id ?? "");
  const [draft, setDraft] = useState<ServiceTemplate | null>(null);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? templates[0],
    [templates, selectedId]
  );

  const refresh = (next: ServiceTemplate[], keepId?: string) => {
    const merged = [...next.filter((t) => !t.builtin), ...templates.filter((t) => t.builtin)];
    setTemplates(merged);
    if (keepId) setSelectedId(keepId);
    else if (!merged.some((t) => t.id === selectedId)) setSelectedId(merged[0]?.id ?? "");
  };

  const startEdit = (template: ServiceTemplate) => {
    // Un modèle fourni n'est jamais modifié sur place : il est la référence
    // documentée. On duplique, et c'est la copie qu'on édite.
    setDraft(template.builtin ? duplicateTemplate(template) : { ...template, steps: template.steps.map((s) => ({ ...s })) });
  };

  const commitDraft = () => {
    if (!draft) return;
    const cleaned: ServiceTemplate = {
      ...draft,
      label: draft.label.trim() || "Mon déroulé",
      steps: draft.steps.filter((s) => s.title.trim() !== ""),
    };
    if (cleaned.steps.length === 0) return;
    refresh(saveUserTemplate(cleaned), cleaned.id);
    setDraft(null);
  };

  if (!selected && !draft) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[760px] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[#1e1f22] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Liste des modèles */}
        <div className="flex w-72 shrink-0 flex-col border-r border-white/5 bg-[#1a1b1e]">
          <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
            <h2 className="min-w-0 flex-1 text-sm font-black tracking-tight text-white">
              Déroulés de culte
            </h2>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {["user", "builtin"].map((group) => {
              const list = templates.filter((t) => (group === "user" ? !t.builtin : t.builtin));
              if (list.length === 0) return null;
              return (
                <div key={group} className="mb-3">
                  <p className="px-2 pb-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-gray-600">
                    {group === "user" ? "Mes déroulés" : "Fournis avec l'application"}
                  </p>
                  <div className="space-y-1">
                    {list.map((t) => {
                      const style = KINDS[t.kind];
                      const Icon = style.icon;
                      const active = t.id === selected?.id && !draft;
                      return (
                        <button
                          key={t.id}
                          onClick={() => { setDraft(null); setSelectedId(t.id); }}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                            active ? "bg-white/10" : "hover:bg-white/5"
                          }`}
                        >
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                            style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
                          >
                            <Icon size={15} className="text-white" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-xs font-bold ${active ? "text-white" : "text-gray-300"}`}>
                              {t.label}
                            </span>
                            <span className="block truncate text-[10px] text-gray-600">{t.when}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-white/5 p-2">
            <button
              onClick={() => setDraft({
                id: "", label: "", when: "", hint: "", kind: "divine",
                steps: [{ title: "" }], builtin: false,
              })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-2 text-[11px] font-bold text-gray-400 transition hover:border-white/35 hover:text-white"
            >
              <Plus size={13} /> Créer un déroulé
            </button>
          </div>
        </div>

        {/* Panneau de droite : aperçu, ou édition */}
        {draft
          ? <TemplateEditor
              draft={draft}
              setDraft={setDraft}
              onCancel={() => setDraft(null)}
              onSave={commitDraft}
            />
          : <TemplateDetail
              template={selected!}
              onClose={onClose}
              onApply={() => onApply(selected!, templateItems(selected!))}
              onEdit={() => startEdit(selected!)}
              onDuplicate={() => {
                const copy = duplicateTemplate(selected!);
                refresh(saveUserTemplate(copy), copy.id);
              }}
              onDelete={() => refresh(deleteUserTemplate(selected!.id))}
            />
        }
      </div>
    </div>
  );
}

/** Aperçu détaillé : ce que le modèle contient, avant de l'insérer. */
function TemplateDetail({ template, onClose, onApply, onEdit, onDuplicate, onDelete }: {
  template: ServiceTemplate;
  onClose: () => void;
  onApply: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const style = KINDS[template.kind];
  const Icon = style.icon;
  const minutes = totalMinutes(template);
  // Horaire cumulé : voir qu'une prédication commence à la 45e minute est plus
  // parlant qu'une liste de durées isolées.
  let running = 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Bandeau */}
      <div
        className="relative shrink-0 px-6 py-5"
        style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-white/70 transition hover:bg-black/20 hover:text-white"
        >
          <X size={16} />
        </button>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/20">
            <Icon size={21} className="text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/70">
              {template.when}
            </p>
            <h3 className="truncate text-lg font-black tracking-tight text-white">{template.label}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/80">
              <span>{template.steps.length} étapes</span>
              {minutes > 0 && (
                <span className="flex items-center gap-1">
                  <Clock size={11} /> environ {formatDuration(minutes)}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <p className="text-xs leading-relaxed text-gray-400">{template.hint}</p>

        {/* La source est AFFICHÉE, pas enfouie dans le code : un ancien doit
            pouvoir vérifier d'où vient ce déroulé. */}
        {template.source && (
          <p className="mt-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-gray-500">
            <span className="font-bold text-gray-400">Source : </span>{template.source}
          </p>
        )}

        <p className="mt-4 mb-2 text-[9px] font-black uppercase tracking-[0.12em] text-gray-600">
          Déroulé
        </p>
        <ol className="space-y-1">
          {template.steps.map((step, i) => {
            const at = running;
            running += step.minutes || 0;
            return (
              <li key={i} className="flex gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/[0.03]">
                <span className="w-6 shrink-0 pt-0.5 text-right text-[10px] font-bold tabular-nums text-gray-600">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-gray-200">{step.title}</span>
                  {step.note && (
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-gray-500">{step.note}</span>
                  )}
                </span>
                {step.minutes ? (
                  <span className="shrink-0 pt-0.5 text-right text-[10px] tabular-nums text-gray-600">
                    <span style={{ color: style.accent }}>+{at}′</span>
                    <span className="ml-1.5">{step.minutes} min</span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-300/90">
          Les étapes sont des repères : elles n'affichent rien à l'écran. Remplace-les
          par le cantique, le texte ou la vidéo au fur et à mesure de ta préparation.
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/5 px-6 py-3">
        <button
          onClick={onApply}
          className="flex items-center gap-1.5 rounded-lg bg-[#5865f2] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#4752c4]"
        >
          <Check size={14} /> Ajouter à l'agenda
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
        >
          <GripVertical size={13} /> {template.builtin ? "Adapter à mon église" : "Modifier"}
        </button>
        <button
          onClick={onDuplicate}
          title="Créer une copie modifiable"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
        >
          <Copy size={13} /> Dupliquer
        </button>
        {!template.builtin && (
          <button
            onClick={onDelete}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-gray-500 transition hover:bg-red-500/15 hover:text-red-400"
          >
            <Trash2 size={13} /> Supprimer
          </button>
        )}
      </div>
    </div>
  );
}

/** Édition d'un déroulé : titre, moment, et les étapes. */
function TemplateEditor({ draft, setDraft, onCancel, onSave }: {
  draft: ServiceTemplate;
  setDraft: (t: ServiceTemplate) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const setStep = (index: number, patch: Partial<TemplateStep>) =>
    setDraft({
      ...draft,
      steps: draft.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });

  const move = (index: number, delta: number) => {
    const next = [...draft.steps];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, steps: next });
  };

  const canSave = draft.steps.some((s) => s.title.trim() !== "");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/5 px-6 py-3">
        <h3 className="min-w-0 flex-1 text-sm font-bold text-white">
          {draft.id ? "Modifier le déroulé" : "Nouveau déroulé"}
        </h3>
        <button onClick={onCancel} className="rounded-full p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Nom</span>
            <input
              autoFocus
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Culte de mon église"
              className="w-full rounded-lg border border-white/10 bg-[#18191c] px-3 py-2 text-xs text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-[#5865f2]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Quand</span>
            <input
              value={draft.when}
              onChange={(e) => setDraft({ ...draft, when: e.target.value })}
              placeholder="Sabbat matin"
              className="w-full rounded-lg border border-white/10 bg-[#18191c] px-3 py-2 text-xs text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-[#5865f2]"
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">Famille</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KINDS) as TemplateKind[]).map((kind) => {
              const style = KINDS[kind];
              const Icon = style.icon;
              const active = draft.kind === kind;
              return (
                <button
                  key={kind}
                  onClick={() => setDraft({ ...draft, kind })}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                    active ? "ring-2 ring-white/60" : "opacity-50 hover:opacity-100"
                  }`}
                  style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
                  title={kind}
                >
                  <Icon size={15} className="text-white" />
                </button>
              );
            })}
          </div>
        </label>

        <p className="mt-4 mb-2 text-[9px] font-black uppercase tracking-[0.12em] text-gray-600">
          Étapes
        </p>
        <div className="space-y-1.5">
          {draft.steps.map((step, i) => (
            <div key={i} className="flex items-start gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-2">
              <div className="flex shrink-0 flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} title="Monter"
                  className="px-1 text-[9px] text-gray-500 transition hover:text-white disabled:opacity-20">▲</button>
                <button onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1} title="Descendre"
                  className="px-1 text-[9px] text-gray-500 transition hover:text-white disabled:opacity-20">▼</button>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <input
                  value={step.title}
                  onChange={(e) => setStep(i, { title: e.target.value })}
                  placeholder="Nom de l'étape"
                  className="w-full rounded border border-white/10 bg-[#18191c] px-2.5 py-1.5 text-xs text-gray-100 outline-none placeholder:text-gray-600 focus:border-[#5865f2]"
                />
                <input
                  value={step.note || ""}
                  onChange={(e) => setStep(i, { note: e.target.value || undefined })}
                  placeholder="Note de préparation (facultatif, jamais projetée)"
                  className="w-full rounded border border-white/5 bg-[#18191c] px-2.5 py-1 text-[11px] text-gray-400 outline-none placeholder:text-gray-700 focus:border-[#5865f2]"
                />
              </div>
              <input
                type="number"
                min={0}
                value={step.minutes ?? ""}
                onChange={(e) => setStep(i, { minutes: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="min"
                className="w-16 shrink-0 rounded border border-white/10 bg-[#18191c] px-2 py-1.5 text-center text-xs tabular-nums text-gray-100 outline-none placeholder:text-gray-600 focus:border-[#5865f2]"
              />
              <button
                onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
                title="Retirer l'étape"
                className="shrink-0 rounded p-1.5 text-gray-600 transition hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => setDraft({ ...draft, steps: [...draft.steps, { title: "" }] })}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 px-3 py-2 text-[11px] font-bold text-gray-400 transition hover:border-white/35 hover:text-white"
        >
          <Plus size={13} /> Ajouter une étape
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/5 px-6 py-3">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="flex items-center gap-1.5 rounded-lg bg-[#5865f2] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#4752c4] disabled:opacity-40"
        >
          <Save size={14} /> Enregistrer le déroulé
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-gray-300 transition hover:border-white/25 hover:text-white"
        >
          Annuler
        </button>
        {!canSave && (
          <span className="text-[11px] text-gray-500">Au moins une étape doit avoir un nom.</span>
        )}
      </div>
    </div>
  );
}
