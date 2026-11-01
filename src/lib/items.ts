// Le modèle de ce qu'on projette.
//
// Jusqu'ici, un élément d'agenda était un `any`. Les quatre gros composants en
// déclaraient 71 au total, et le même objet circulait entre la barre latérale,
// l'aperçu et la fenêtre de projection sans qu'aucun contrat ne soit vérifié.
//
// ⚠ PREMIER PIÈGE : le champ `lyrics` ne contient pas toujours des paroles.
//
//   - cantique, chapitre, texte, programme libre, markdown -> du TEXTE ;
//   - image, vidéo, audio, document                        -> un CHEMIN ;
//   - youtube                                              -> un IDENTIFIANT ;
//   - lien                                                 -> une URL.
//
// C'est un héritage : la première version ne projetait que des chants, et le
// champ a été réemployé au fil des ajouts. Le renommer casserait tous les
// agendas enregistrés, donc on le garde — mais on ne le lit plus à la main.
// `textOf()` et `sourceOf()` disent lequel des deux sens s'applique.
//
// ⚠ SECOND PIÈGE : il y a NEUF natures, pas quatre. `hymnes` et `bible` sont
// posées par le backend Rust (`song_type`), `custom` par le bouton « Programme
// libre », et les autres par la bibliothèque ou l'import de fichiers. Une
// condition écrite sur une liste partielle — c'est arrivé deux fois dans
// l'historique, voir `MiddleEditor` — laisse passer les natures ajoutées
// ensuite. D'où l'énumération explicite ci-dessous et les prédicats qui vont
// avec : on teste une INTENTION (« est-ce que ça vient d'une base ? »), pas
// une liste de chaînes.

/** Les natures d'élément que l'agenda sait projeter. */
export type ItemType =
  | "hymnes"
  | "bible"
  | "custom"
  | "text"
  | "markdown"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "youtube"
  | "link";

/** Champs communs à tout ce qui peut entrer dans un agenda. */
interface BaseItem {
  id: string;
  title: string;
  /**
   * Pastille affichée devant le titre : un numéro de cantique, un numéro de
   * chapitre, ou un émoji posé par la bibliothèque (« 🎵 », « 📖 », « 📘 »).
   * C'est un libellé, pas une clé — ne jamais s'en servir pour identifier.
   */
  number?: string;
}

/**
 * Cantique ou chapitre biblique venant d'une base chargée.
 *
 * `type` est posé par le backend (`song_type`). Il peut être absent sur un
 * agenda enregistré par une version ancienne : le traiter comme du texte est
 * le bon repli.
 */
export interface SongItem extends BaseItem {
  type?: "hymnes" | "bible";
  /** Les paroles, ou les versets du chapitre. */
  lyrics: string;
  /**
   * Nom du fichier SQLite d'origine. C'est LUI qui dit qu'un élément vient
   * d'une base, et donc qu'il peut y être réécrit — pas son type.
   */
  book?: string;
  /** Rang du livre (1 = Genèse). Sert à retrouver l'audio. */
  book_index?: number;
  abbr?: string;
  version?: string;
  startVerse?: string;
  endVerse?: string;
  /** Recueil de playback, pour un cantique qui en a un. */
  playback?: string;
}

/** Texte libre saisi par l'opérateur (« Programme libre »). */
export interface CustomItem extends BaseItem {
  type: "custom";
  lyrics: string;
}

/** Texte ajouté depuis la bibliothèque (méditation Mofon'aina). */
export interface TextItem extends BaseItem {
  type: "text";
  lyrics: string;
}

/** Diapos écrites en Markdown, découpées par l'auteur sur les barres `---`. */
export interface MarkdownItem extends BaseItem {
  type: "markdown";
  lyrics: string;
}

/** Élément dont `lyrics` porte un chemin de fichier local. */
export interface MediaItem extends BaseItem {
  type: "image" | "video" | "audio" | "document";
  /** ⚠ Un CHEMIN, pas du texte. Passer par `sourceOf()`. */
  lyrics: string;
}

/** Vidéo YouTube : `lyrics` porte l'identifiant, pas l'URL complète. */
export interface YoutubeItem extends BaseItem {
  type: "youtube";
  lyrics: string;
}

/** Page web projetée dans un cadre. */
export interface LinkItem extends BaseItem {
  type: "link";
  /** ⚠ Une URL, pas du texte. */
  lyrics: string;
  /**
   * Faux quand le site refuse d'être affiché dans un cadre (vérifié côté Rust).
   * `undefined` signifie « pas encore vérifié », ce qui n'est pas la même chose
   * que « refuse » : la projection ne doit pas afficher l'avertissement dans ce
   * cas.
   */
  embeddable?: boolean;
  embedReason?: string;
}

export type PlaylistItem =
  | SongItem | CustomItem | TextItem | MarkdownItem | MediaItem | YoutubeItem | LinkItem;

/** Les natures dont `lyrics` est un chemin, une URL ou un identifiant. */
const SOURCE_TYPES: ReadonlySet<ItemType> = new Set<ItemType>([
  "image", "video", "audio", "document", "youtube", "link",
]);

/** Les natures qui portent du texte à projeter diapo par diapo. */
const TEXT_TYPES: ReadonlySet<ItemType> = new Set<ItemType>([
  "hymnes", "bible", "custom", "text", "markdown",
]);

/**
 * Nature effective d'un élément.
 *
 * Un agenda enregistré par une version ancienne peut ne pas porter de `type` :
 * il s'agit alors d'un cantique, donc du texte.
 */
export function itemType(item: { type?: string } | null | undefined): ItemType {
  return (item?.type as ItemType) ?? "hymnes";
}

/** Vrai si `lyrics` porte un chemin / une URL / un identifiant, et non du texte. */
export function hasSource(item: { type?: string } | null | undefined): boolean {
  return SOURCE_TYPES.has(itemType(item));
}

/** Vrai si l'élément se projette comme du texte découpé en diapos. */
export function isTextual(item: { type?: string } | null | undefined): boolean {
  return TEXT_TYPES.has(itemType(item));
}

/**
 * Le TEXTE à projeter, ou `null` si l'élément n'en porte pas.
 *
 * Renvoyer `null` plutôt que la chaîne brute est délibéré : projeter le chemin
 * `/home/.../video.mp4` en lettres géantes est un incident qu'on a le devoir de
 * rendre impossible, pas seulement improbable.
 *
 * ⚠ On teste l'appartenance à `TEXT_TYPES`, pas la NON-appartenance à
 * `SOURCE_TYPES` : une nature ajoutée demain et oubliée dans les deux listes
 * sera traitée comme un média (rien ne s'affiche, on le voit tout de suite)
 * plutôt que comme du texte (on projette un chemin de fichier à l'assemblée).
 */
export function textOf(item: PlaylistItem | null | undefined): string | null {
  if (!item || !isTextual(item)) return null;
  return item.lyrics ?? "";
}

/**
 * La SOURCE d'un média (chemin, URL ou identifiant YouTube), ou `null` si
 * l'élément porte du texte.
 */
export function sourceOf(item: PlaylistItem | null | undefined): string | null {
  if (!item || !hasSource(item)) return null;
  return item.lyrics ?? "";
}

/**
 * Vrai si l'élément vient d'une base SQLite, et peut donc y être réécrit.
 *
 * ⚠ C'est la PROVENANCE qui compte, pas le type : `book` porte le nom du
 * fichier d'origine. Tester une liste de types faisait que chaque nature
 * ajoutée ensuite tentait d'écrire dans « undefined.SQLite3 ».
 */
export function isFromDatabase(item: PlaylistItem | null | undefined): item is SongItem {
  const book = (item as SongItem | null | undefined)?.book;
  return typeof book === "string" && book.trim() !== "";
}

/**
 * Vrai si l'élément est un chapitre biblique.
 *
 * On accepte aussi `version`, car les agendas enregistrés avant que le backend
 * ne pose `song_type` n'ont que ce champ-là.
 *
 * ⚠ Renvoie un `boolean`, PAS un prédicat `item is SongItem`. Un cantique et
 * un chapitre sont tous deux des `SongItem` : prétendre restreindre le type
 * faisait que `isFromDatabase(x) && !isBibleChapter(x)` — « un cantique
 * modifiable » — se réduisait à `never`, et plus aucun champ n'était lisible.
 */
export function isBibleChapter(item: PlaylistItem | null | undefined): boolean {
  if (!item) return false;
  if (itemType(item) === "bible") return true;
  return !!(item as SongItem).version;
}

/** Un document PDF, qui se projette page par page et non diapo par diapo. */
export function isPdf(item: PlaylistItem | null | undefined): boolean {
  return itemType(item) === "document" && /\.pdf(\?.*)?$/i.test(sourceOf(item) || "");
}

/**
 * Identifiant unique pour un nouvel élément.
 *
 * ⚠ `Date.now()` seul ne suffit pas. Ajouter plusieurs éléments dans la même
 * milliseconde — ce que fait tout ajout en lot, et la génération d'un culte —
 * produisait des identifiants IDENTIQUES. React s'en sert comme `key`, et deux
 * éléments de même clé, c'est une diapo qui en remplace une autre à l'écran
 * sans raison visible.
 */
let counter = 0;
export function newItemId(): string {
  counter = (counter + 1) % 100000;
  return `${Date.now()}-${counter.toString(36)}`;
}
