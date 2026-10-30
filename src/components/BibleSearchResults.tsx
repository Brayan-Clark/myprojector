import { Fragment, useMemo } from "react";
import { BookOpen, Loader2, SearchX } from "lucide-react";
import { fold, searchTerms } from "../lib/fold";

export type BibleHit = {
  book: string;
  abbr?: string | null;
  chapter: number;
  verse: number;
  text: string;
};

/**
 * Surligne les mots trouvés, mot par mot.
 *
 * On compare des mots ENTIERS normalisés plutôt que de chercher la position du
 * terme dans le texte d'origine : la normalisation change parfois la longueur
 * (« œuvre » → « oeuvre »), les index ne correspondent donc plus et le
 * surlignage se décalait d'un caractère sur les versets accentués.
 */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => text.split(/(\s+)/), [text]);
  if (terms.length === 0) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        const folded = fold(part);
        const hit = part.trim() && terms.some((t) => folded.includes(t));
        return hit ? (
          <mark key={i} className="rounded bg-[#5865f2]/40 px-0.5 text-white">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

export function BibleSearchResults({
  query,
  hits,
  loading,
  error,
  onPick,
  truncated,
}: {
  query: string;
  hits: BibleHit[];
  loading: boolean;
  error: string | null;
  onPick: (hit: BibleHit) => void;
  /** Vrai quand la limite du backend est atteinte : il y a d'autres versets. */
  truncated: boolean;
}) {
  const terms = useMemo(() => searchTerms(query), [query]);

  if (query.trim().length < 2) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-gray-500">
        <BookOpen size={24} />
        <p className="text-xs font-bold text-gray-400">Chercher dans le texte</p>
        <p className="text-[11px] leading-relaxed">
          Tapez un ou plusieurs mots : tous doivent apparaître dans le verset.
          <br />
          Entre guillemets, <code className="rounded bg-[#1e1f22] px-1">"fitiavana lehibe"</code> cherche
          l'expression exacte.
        </p>
        <p className="text-[10px] text-gray-600">Les accents et les majuscules sont ignorés.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Recherche…
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-2 rounded border border-red-500/20 bg-red-500/10 p-3 text-[11px] text-red-400">
        {error}
      </div>
    );
  }

  if (hits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-gray-500">
        <SearchX size={24} />
        <p className="text-xs">Aucun verset ne contient tous ces mots.</p>
        <p className="text-[10px] text-gray-600">
          Essayez avec moins de mots, ou vérifiez la version biblique choisie.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        {hits.length} verset{hits.length > 1 ? "s" : ""}
        {truncated && " (premiers résultats)"}
      </div>
      {hits.map((hit) => (
        <button
          key={`${hit.book}-${hit.chapter}-${hit.verse}`}
          onClick={() => onPick(hit)}
          className="group rounded border border-transparent bg-[#36393f] px-2 py-1.5 text-left transition hover:border-[#5865f2] hover:bg-[#4752c4]"
          title={`Ouvrir ${hit.book} ${hit.chapter}:${hit.verse}`}
        >
          <div className="text-[10px] font-bold text-[#8891f2] group-hover:text-white">
            {hit.book} {hit.chapter}:{hit.verse}
          </div>
          <p className="mt-0.5 line-clamp-3 text-[11px] leading-snug text-gray-300 group-hover:text-white">
            <Highlighted text={hit.text} terms={terms} />
          </p>
        </button>
      ))}
      {truncated && (
        <p className="px-1 py-2 text-[10px] leading-relaxed text-gray-600">
          Seuls les premiers versets sont affichés. Ajoutez un mot pour affiner.
        </p>
      )}
    </div>
  );
}
