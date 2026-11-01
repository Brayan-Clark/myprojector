// École du Sabbat : langues, classes, trimestres et leçons.
//
// Les données viennent de l'API publique qui alimente l'application mobile
// Sabbath School (adventech.io) et les miroirs de la SSPM. Rien n'est
// embarqué : la liste des langues, celle des classes et les leçons elles-mêmes
// sont publiées en amont, et doivent apparaître ici sans qu'on livre une
// nouvelle version de MyProjector.
//
// Les deux hôtes `inverse` et `absg` servent la MÊME charge utile pour toutes
// les langues : le second n'est qu'un repli quand le premier ne répond pas.
// L'un d'eux porte historiquement les leçons malgaches et les classes
// « -cq », d'où l'ordre choisi par `hostsFor`.

/** Liste des langues publiées en amont (95 au moment d'écrire ces lignes). */
const LANGUAGES_URL = "https://sabbath-school.adventech.io/api/v2/languages/index.json";

const CACHE_PREFIX = "ss:";
/**
 * Un cache ne doit jamais faire échouer l'affichage ni remplir le stockage du
 * navigateur : au-delà de cette taille on ne garde rien, et la section
 * retombe sur le réseau.
 */
const MAX_CACHE_BYTES = 400 * 1024;

export interface SsLanguage {
  code: string;
  /** Nom tel que servi par l'API (en anglais). */
  name: string;
  /** Endonyme quand on le connaît, sinon `name`. */
  label: string;
  flag: string;
}

export interface SsQuarterly {
  id: string;
  title: string;
  description?: string;
  subtitle?: string;
  cover?: string;
  /** Chemin d'API du trimestre (« fr/ss/2026-04 »). */
  index: string;
  /** Dates au format du livret, `jj/mm/aaaa`. */
  startDate?: string;
  endDate?: string;
  color?: string;
  /** Classe à laquelle il appartient (« Classe des Adultes », « InVerse »…). */
  groupTitle: string;
}

export interface SsLesson {
  id: string;
  /** Numéro sur deux chiffres (« 01 »). */
  name: string;
  title: string;
  index: string;
  startDate?: string;
  endDate?: string;
}

export interface SsSegment {
  id: string;
  name: string;
  title: string;
  /** Date du jour, format du livret. */
  date?: string;
  /** Contenu converti en Markdown, découpé en diapos par `---`. */
  markdown: string;
}

export interface SsLessonContent {
  id: string;
  title: string;
  segments: SsSegment[];
}

/** Index d'une langue : les classes, et les trimestres de chacune. */
export interface SsIndex {
  categories: string[];
  quarterlies: SsQuarterly[];
}

// ---------------------------------------------------------------------------
// Langues
// ---------------------------------------------------------------------------

/** Affichées en tête de liste : les langues de l'application elle-même. */
export const PINNED_LANGUAGES = ["mg", "fr", "en"];

/**
 * Endonymes, pour qu'un lecteur reconnaisse sa propre langue. Repris de
 * l'application amont ; un code absent d'ici retombe sur le nom anglais
 * renvoyé par l'API — c'est préférable à une traduction approximative.
 */
const NATIVE_NAMES: Record<string, string> = {
  af: "Afrikaans", am: "አማርኛ", ar: "عربى", as: "অসমীয়া", az: "Azərbaycan",
  bbc: "Batak Toba", bg: "Български", bn: "বাংলা", ca: "Català", ceb: "Sinugboanon",
  cfm: "Lai ṭong", cs: "Český", ctd: "Tedim Chin", da: "Dansk", de: "Deutsch",
  el: "Ελληνικά", en: "English", es: "Español", et: "Eesti Keel", fa: "فارسی",
  fi: "Suomen kieli", fj: "Viti", fr: "Français", grt: "Garo", gu: "ગુજરાતી",
  he: "עִברִית", hi: "हिन्दी", hil: "Hiligaynon", hmn: "Lus Hmoob", hr: "Hrvatski",
  ht: "Kreyòl ayisyen", hu: "Magyar", hy: "Հայերեն", iba: "Jaku Iban", ilo: "Ilokano",
  in: "Bahasa Indonesia", is: "Íslenska", it: "Italiano", ja: "日本語",
  ka: "ქართული ენა", kar: "ကညီကျိာ်", kha: "Khasi", kin: "Ikinyarwanda",
  kjp: "အရှေ့ပိုးကရင်", km: "ខ្មែរ", kn: "ಕನ್ನಡ", ko: "한국어", ky: "Кыргыз",
  kz: "Қазақша", lo: "ລາວ", lt: "Lietuviškai", lus: "Mizo ṭawng", lv: "Latviešu valoda",
  mg: "Malagasy", mk: "Македонски", ml: "മലയാളം", mn: "Монгол хэл", mr: "मराठी",
  ms: "Bahasa Malaysia", my: "မြန်မာဘာသာ", ne: "नेपाली", nl: "Nederlandse taal",
  no: "Norsk", om: "Afaan Oromoo", or: "ଓଡ଼ିଆ", pap: "Papiamentu", pl: "Polski",
  pt: "Português", ro: "Română", ru: "Русский", run: "Ikirundi", si: "සිංහල",
  sk: "Slovenčina", sl: "Slovenščina", sn: "ChiShona", sq: "Shqiptar", sr: "Srpski",
  st: "Sesotho", sv: "Svenska", sw: "Kiswahili", ta: "தமிழ்", te: "తెలుగు",
  tg: "Тоҷикӣ", th: "ไทย", ti: "ትግርኛ", tl: "Tagalog", tr: "Türk", trp: "Kokborok",
  tw: "Twi", uk: "Українська", uz: "Ўзбекча", vi: "Việt", xh: "IsiXhosa",
  zh: "中文", zu: "IsiZulu",
};

/**
 * Drapeaux des langues qui correspondent à un pays évident. La plupart des 95
 * codes n'en ont pas (swahili, arabe, espagnol…) : ceux-là reçoivent leur code
 * en pastille, et cette table reste volontairement courte plutôt que
 * d'attribuer un drapeau arbitraire à une langue parlée dans vingt pays.
 */
const FLAGS: Record<string, string> = {
  mg: "🇲🇬", fr: "🇫🇷", en: "🇬🇧", pt: "🇵🇹", de: "🇩🇪", it: "🇮🇹", ru: "🇷🇺",
  uk: "🇺🇦", pl: "🇵🇱", ro: "🇷🇴", ja: "🇯🇵", ko: "🇰🇷", zh: "🇨🇳", th: "🇹🇭",
  vi: "🇻🇳", in: "🇮🇩", ms: "🇲🇾", tl: "🇵🇭", tr: "🇹🇷", el: "🇬🇷", he: "🇮🇱",
  hu: "🇭🇺", cs: "🇨🇿", sk: "🇸🇰", hr: "🇭🇷", sr: "🇷🇸", bg: "🇧🇬", da: "🇩🇰",
  sv: "🇸🇪", no: "🇳🇴", fi: "🇫🇮", is: "🇮🇸", nl: "🇳🇱", et: "🇪🇪", lv: "🇱🇻",
  lt: "🇱🇹", sq: "🇦🇱", mk: "🇲🇰", sl: "🇸🇮", hy: "🇦🇲", ka: "🇬🇪", mn: "🇲🇳",
  km: "🇰🇭", lo: "🇱🇦", my: "🇲🇲", ne: "🇳🇵", si: "🇱🇰", fa: "🇮🇷", am: "🇪🇹",
  ht: "🇭🇹", fj: "🇫🇯", kin: "🇷🇼", run: "🇧🇮", zu: "🇿🇦", xh: "🇿🇦", af: "🇿🇦",
  st: "🇱🇸", sn: "🇿🇼", az: "🇦🇿", kz: "🇰🇿", ky: "🇰🇬", uz: "🇺🇿", tg: "🇹🇯",
};

export function buildLanguage(code: string, name?: string): SsLanguage {
  const trimmed = (code || "").trim();
  const apiName = (name || "").trim();
  return {
    code: trimmed,
    name: apiName || NATIVE_NAMES[trimmed] || trimmed.toUpperCase(),
    label: NATIVE_NAMES[trimmed] || apiName || trimmed.toUpperCase(),
    flag: FLAGS[trimmed] || "",
  };
}

/** Repli au premier lancement hors ligne, avant toute réponse de l'API. */
export const DEFAULT_LANGUAGES: SsLanguage[] = PINNED_LANGUAGES.map((c) => buildLanguage(c));

/** Normalise un libellé pour comparer sans accents ni apostrophes. */
export const normalizeLabel = (value: string): string =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Langues épinglées d'abord (dans leur ordre), puis l'ordre de l'API. */
export function sortLanguages(list: SsLanguage[]): SsLanguage[] {
  const rank = (code: string) => {
    const i = PINNED_LANGUAGES.indexOf(code);
    return i === -1 ? PINNED_LANGUAGES.length : i;
  };
  return [...list].sort((a, b) => rank(a.code) - rank(b.code));
}

/** Recherche sur l'endonyme, le nom anglais ET le code : 95 entrées ne se
 *  parcourent pas à l'œil. */
export function filterLanguages(list: SsLanguage[], query: string): SsLanguage[] {
  const q = normalizeLabel(query);
  if (!q) return list;
  const has = (v: string) => normalizeLabel(v).includes(q);
  return list.filter((l) => has(l.label) || has(l.name) || has(l.code));
}

// ---------------------------------------------------------------------------
// Réseau, avec cache de repli
// ---------------------------------------------------------------------------

const readCache = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const writeCache = (key: string, value: unknown) => {
  try {
    const text = JSON.stringify(value);
    if (text.length > MAX_CACHE_BYTES) return;
    localStorage.setItem(CACHE_PREFIX + key, text);
  } catch {
    // Quota atteint : la section continue de fonctionner en ligne.
  }
};

export interface Cached<T> { data: T; stale: boolean }

/**
 * Premier hôte qui répond, parmi ceux proposés.
 *
 * On ajoute un paramètre anti-cache : ces index sont servis derrière un CDN
 * qui garde longtemps les anciennes versions, et une leçon publiée le vendredi
 * doit être visible le vendredi.
 */
async function fetchFirst(urls: string[]): Promise<any> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}t=${Date.now()}`);
      if (!res.ok) { lastError = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Hôte injoignable");
}

/**
 * Les deux miroirs, dans l'ordre à essayer.
 *
 * `inverse` porte les leçons malgaches et les classes « -cq » ; pour tout le
 * reste `absg` répond plus souvent du premier coup. Les deux servent la même
 * charge utile, donc se tromper d'ordre coûte une requête, pas un échec.
 */
function hostsFor(path: string): string[] {
  const inverseFirst = path.includes("/mg/") || path.startsWith("mg/") || path.includes("-cq");
  const hosts = inverseFirst
    ? ["inverse.sspmadventist.org", "absg.sspmadventist.org"]
    : ["absg.sspmadventist.org", "inverse.sspmadventist.org"];
  return hosts.map((h) => `https://${h}/api/v3/${path}`);
}

/** Toutes les langues disponibles. */
export async function fetchLanguages(): Promise<Cached<SsLanguage[]>> {
  try {
    const data = await fetchFirst([LANGUAGES_URL]);
    if (!Array.isArray(data)) throw new Error("Réponse inattendue");
    const seen = new Set<string>();
    const list: SsLanguage[] = [];
    for (const entry of data) {
      const code = typeof entry?.code === "string" ? entry.code.trim() : "";
      if (!code || seen.has(code)) continue;
      seen.add(code);
      list.push(buildLanguage(code, entry?.name));
    }
    if (list.length === 0) throw new Error("Aucune langue publiée");
    writeCache("languages", list.map(({ code, name }) => ({ code, name })));
    return { data: sortLanguages(list), stale: false };
  } catch (e) {
    const cached = readCache<{ code: string; name: string }[]>("languages");
    if (cached?.length) {
      // Reconstruit : un endonyme ou un drapeau ajouté depuis s'applique
      // aussi à un cache ancien.
      return { data: sortLanguages(cached.map((l) => buildLanguage(l.code, l.name))), stale: true };
    }
    if (import.meta.env?.DEV) console.warn("École du Sabbat : langues", e);
    return { data: DEFAULT_LANGUAGES, stale: true };
  }
}

/**
 * Classes et trimestres d'une langue.
 *
 * ⚠ Les classes ne sont PAS codées en dur. Elles varient d'une langue à
 * l'autre (« Lesona Lehibe » en malgache, « InVerse » en français, douze
 * classes en anglais) et l'amont en ajoute : les figer afficherait des filtres
 * qui ne correspondent à rien.
 */
export async function fetchIndex(lang: string): Promise<Cached<SsIndex>> {
  const key = `index:${lang}`;
  try {
    const data = await fetchFirst(hostsFor(`${lang}/ss/index.json`));
    const categories: string[] = [];
    const quarterlies: SsQuarterly[] = [];
    for (const group of data?.groups || []) {
      const groupTitle = typeof group?.title === "string" ? group.title.trim() : "";
      if (groupTitle && !categories.includes(groupTitle)) categories.push(groupTitle);
      for (const res of group?.resources || []) {
        if (!res?.index || !res?.id) continue;
        quarterlies.push({
          id: String(res.id),
          title: cleanInline(res.title || ""),
          description: cleanInline(res.description || ""),
          subtitle: res.subtitle || undefined,
          cover: res.covers?.portrait || res.covers?.square || res.covers?.landscape,
          index: String(res.index),
          startDate: res.startDate,
          endDate: res.endDate,
          color: res.primaryColor,
          groupTitle: groupTitle || "—",
        });
      }
    }
    if (quarterlies.length === 0) throw new Error("Aucun trimestre publié");
    const index: SsIndex = { categories, quarterlies };
    writeCache(key, index);
    return { data: index, stale: false };
  } catch (e) {
    const cached = readCache<SsIndex>(key);
    if (cached) return { data: cached, stale: true };
    throw e;
  }
}

/**
 * Leçons d'un trimestre.
 *
 * C'est `sections/index.json` qui les porte — l'`index.json` du trimestre, lui,
 * ne contient que sa présentation. En une requête on obtient les vrais titres
 * ET les vraies dates, là où deviner « 01 » à « 13 » obligerait à interroger
 * treize fois l'API pour n'obtenir que des numéros.
 */
export async function fetchLessons(quarterlyIndex: string): Promise<Cached<SsLesson[]>> {
  const key = `lessons:${quarterlyIndex}`;
  try {
    const data = await fetchFirst(hostsFor(`${quarterlyIndex}/sections/index.json`));
    const lessons: SsLesson[] = [];
    for (const section of data?.sections || []) {
      for (const doc of section?.documents || []) {
        if (!doc?.index || !doc?.name) continue;
        lessons.push({
          id: String(doc.id || doc.index),
          name: String(doc.name),
          title: cleanInline(doc.title || `Leçon ${doc.name}`),
          index: String(doc.index),
          startDate: doc.startDate,
          endDate: doc.endDate,
        });
      }
    }
    if (lessons.length === 0) throw new Error("Aucune leçon publiée");
    writeCache(key, lessons);
    return { data: lessons, stale: false };
  } catch (e) {
    const cached = readCache<SsLesson[]>(key);
    if (cached) return { data: cached, stale: true };
    throw e;
  }
}

/** Contenu d'une leçon : un segment par jour de la semaine. */
export async function fetchLesson(lessonIndex: string): Promise<Cached<SsLessonContent>> {
  const key = `lesson:${lessonIndex}`;
  try {
    const data = await fetchFirst(hostsFor(`${lessonIndex}/index.json`));
    const segments: SsSegment[] = [];
    for (const seg of data?.segments || []) {
      const markdown = blocksToMarkdown(seg?.blocks || []);
      if (!markdown.trim()) continue;
      segments.push({
        id: String(seg.id || seg.index || segments.length),
        name: String(seg.name || ""),
        title: cleanInline(seg.title || ""),
        date: seg.date,
        markdown,
      });
    }
    if (segments.length === 0) throw new Error("Leçon vide ou non encore publiée");
    const content: SsLessonContent = {
      id: String(data?.id || lessonIndex),
      title: cleanInline(data?.title || ""),
      segments,
    };
    writeCache(key, content);
    return { data: content, stale: false };
  } catch (e) {
    const cached = readCache<SsLessonContent>(key);
    if (cached) return { data: cached, stale: true };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Conversion du contenu en diapos
// ---------------------------------------------------------------------------

/**
 * Nettoie le Markdown de l'amont.
 *
 * Les références bibliques et les citations sont écrites comme des liens vers
 * des schémas internes à l'application mobile (`sspmBible://`, `sspmEGW://`).
 * Projetés tels quels, on verrait `[Gn 1:27](sspmBible://Genesis 1:27)` en
 * plein écran. On garde le libellé, on jette la cible — elle ne mène nulle
 * part ici.
 */
export function cleanInline(text: string): string {
  return (text || "")
    .replace(/\[([^\]]*)\]\((?:sspm[a-z]*|ssbible|egw):\/\/[^)]*\)/gi, "$1")
    // Les ancres HTML que l'amont insère parfois dans les titres.
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .trim();
}

/**
 * Convertit les blocs d'un jour en Markdown découpé en diapos.
 *
 * Le type `markdown` de l'agenda sépare les diapos sur une barre `---` (voir
 * `lib/slides.ts`) : on la pose entre les unités de lecture. Chaque paragraphe
 * devient donc une diapo, ce qui est le rythme d'une projection — un écran de
 * texte qu'on lit, puis le suivant.
 */
export function blocksToMarkdown(blocks: any[]): string {
  const slides: string[] = [];

  /**
   * Titre en attente.
   *
   * Un `heading` seul remplissait une diapo entière avec « Lecture de la
   * semaine » et rien d'autre : l'assemblée voyait un écran de titre, puis un
   * écran de contenu. Le titre est donc gardé de côté et collé en tête de la
   * diapo suivante, à laquelle il appartient.
   */
  let pendingHeading: string | null = null;

  const push = (text: string) => {
    const clean = cleanInline(text);
    if (!clean) return;
    slides.push(pendingHeading ? `${pendingHeading}\n\n${clean}` : clean);
    pendingHeading = null;
  };

  /** Rend le texte d'un bloc et de ses enfants, sans créer de diapo. */
  const flatten = (list: any[], quote: boolean): string => {
    const parts: string[] = [];
    for (const block of list || []) {
      const md = typeof block?.markdown === "string" ? cleanInline(block.markdown) : "";
      if (md) parts.push(quote ? `> ${md.replace(/\n/g, "\n> ")}` : md);
      const nested = flatten(block?.items || [], quote);
      if (nested) parts.push(nested);
    }
    return parts.join(quote ? "\n>\n" : "\n\n");
  };

  const walk = (list: any[]) => {
    for (const block of list || []) {
      const type = String(block?.type || "");
      const md = typeof block?.markdown === "string" ? block.markdown : "";

      switch (type) {
        case "heading":
          pendingHeading = cleanInline(md) ? `## ${cleanInline(md)}` : null;
          break;
        case "paragraph":
        case "excerpt":
          push(md);
          break;
        case "blockquote":
          // UNE diapo pour toute la citation. Le verset à mémoriser se
          // présente comme « Verset à mémoriser : » suivi du texte : séparer
          // les deux donnait une diapo ne contenant que l'intitulé.
          push(flatten(block?.items || [], true));
          break;
        case "collapse":
          // Enveloppe dépliable : son contenu est du texte ordinaire.
          walk(block?.items || []);
          break;
        case "list":
          // Une liste tient sur une diapo : ses puces se lisent ensemble.
          push(
            (block?.items || [])
              .map((it: any) => cleanInline(it?.markdown || ""))
              .filter(Boolean)
              .map((t: string) => `- ${t}`)
              .join("\n")
          );
          break;
        // L'amont écrit `list-item`; `listItem` est toléré au cas où la
        // convention change, ce qui s'est déjà produit sur d'autres types.
        case "list-item":
        case "listItem":
          push(`- ${md}`);
          break;
        case "question":
          // Mise en valeur : une question posée à l'assemblée doit se
          // distinguer du texte qui l'entoure.
          push(`**${md}**`);
          break;
        case "hr":
          // Déjà traité : chaque unité est une diapo.
          break;
        case "image":
        case "video":
        case "audio":
        case "reference":
        case "appeal":
          // Médias et renvois de navigation : rien à projeter comme texte.
          break;
        default:
          // Un type inconnu qui porte du texte vaut mieux affiché que perdu.
          if (md) push(md);
          else walk(block?.items || []);
      }
    }
  };

  walk(blocks);
  // Un titre en fin de segment n'a plus de contenu à accompagner : il devient
  // sa propre diapo plutôt que d'être perdu.
  if (pendingHeading) slides.push(pendingHeading);
  return slides.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `jj/mm/aaaa` → `aaaa-mm-jj`, ou `null` si la forme n'est pas celle-là. */
export function isoDate(value?: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Date locale du jour au format `aaaa-mm-jj` (jamais en UTC : voir Mofon'aina). */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Vrai si aujourd'hui tombe dans l'intervalle (bornes incluses). */
export function coversToday(start?: string, end?: string): boolean {
  const a = isoDate(start);
  const b = isoDate(end);
  if (!a || !b) return false;
  const now = todayIso();
  return a <= now && now <= b;
}

/** « 26 sept. → 2 oct. », ou une chaîne vide si les dates manquent. */
export function dateRange(start?: string, end?: string): string {
  const a = isoDate(start);
  const b = isoDate(end);
  if (!a || !b) return "";
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return `${fmt(a)} → ${fmt(b)}`;
}
