import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown, buildLanguage, cleanInline, coversToday, dateRange,
  filterLanguages, isoDate, normalizeLabel, sortLanguages,
} from "./sabbathSchool";

const slidesOf = (markdown: string) =>
  markdown.split(/\n\s*---\s*\n/).map((s) => s.trim()).filter(Boolean);

describe("cleanInline", () => {
  it("garde le libellé et jette les liens internes de l'amont", () => {
    // Projetés tels quels, on verrait l'URL en plein écran.
    expect(cleanInline("[Gn 1:27](sspmBible://Genesis 1:27)")).toBe("Gn 1:27");
    expect(cleanInline("[DHK 12](sspmEGW://steps/12)")).toBe("DHK 12");
  });

  it("laisse intacts les liens ordinaires", () => {
    expect(cleanInline("[site](https://exemple.org)")).toBe("[site](https://exemple.org)");
  });

  it("retire les balises HTML insérées dans les titres", () => {
    expect(cleanInline("<em>Le</em> Créateur parle")).toBe("Le Créateur parle");
  });

  it("préserve le Markdown de mise en forme", () => {
    // `**` et `_` servent au rendu de la diapo : les retirer appauvrirait la
    // projection.
    expect(cleanInline("**Tsianjery** et _emphase_")).toBe("**Tsianjery** et _emphase_");
  });

  it("tolère une entrée vide", () => {
    expect(cleanInline("")).toBe("");
    expect(cleanInline(undefined as any)).toBe("");
  });
});

describe("blocksToMarkdown", () => {
  it("fait une diapo par paragraphe", () => {
    const md = blocksToMarkdown([
      { type: "paragraph", markdown: "Premier" },
      { type: "paragraph", markdown: "Second" },
    ]);
    expect(slidesOf(md)).toEqual(["Premier", "Second"]);
  });

  /**
   * Un titre seul remplissait une diapo entière avec « Lecture de la semaine »
   * et rien d'autre : l'assemblée voyait un écran de titre, puis un écran de
   * contenu.
   */
  it("colle un titre à la diapo suivante au lieu de l'isoler", () => {
    const slides = slidesOf(blocksToMarkdown([
      { type: "heading", markdown: "Lecture de la semaine" },
      { type: "paragraph", markdown: "Gn 1:27, 28" },
    ]));
    expect(slides).toHaveLength(1);
    expect(slides[0]).toBe("## Lecture de la semaine\n\nGn 1:27, 28");
  });

  it("garde un titre final plutôt que de le perdre", () => {
    expect(slidesOf(blocksToMarkdown([
      { type: "paragraph", markdown: "Corps" },
      { type: "heading", markdown: "Pour aller plus loin" },
    ]))).toEqual(["Corps", "## Pour aller plus loin"]);
  });

  /**
   * Le verset à mémoriser se présente comme un intitulé suivi du texte.
   * Les séparer donnait une diapo ne contenant que « Verset à mémoriser : ».
   */
  it("garde une citation entière sur une seule diapo", () => {
    const slides = slidesOf(blocksToMarkdown([
      {
        type: "blockquote",
        items: [
          { type: "paragraph", markdown: "**Verset à mémoriser**" },
          { type: "paragraph", markdown: "« Dieu a parlé… »" },
        ],
      },
    ]));
    expect(slides).toHaveLength(1);
    expect(slides[0]).toBe("> **Verset à mémoriser**\n>\n> « Dieu a parlé… »");
  });

  it("met les questions en valeur", () => {
    expect(slidesOf(blocksToMarkdown([{ type: "question", markdown: "Que dit le texte ?" }])))
      .toEqual(["**Que dit le texte ?**"]);
  });

  // L'amont écrit `list-item`, pas `listItem`.
  it("rend une liste sur une seule diapo, quelle que soit la graphie", () => {
    const slides = slidesOf(blocksToMarkdown([
      { type: "list", items: [
        { type: "list-item", markdown: "Un" },
        { type: "list-item", markdown: "Deux" },
      ] },
    ]));
    expect(slides).toEqual(["- Un\n- Deux"]);
  });

  it("déplie une enveloppe « collapse »", () => {
    expect(slidesOf(blocksToMarkdown([
      { type: "collapse", items: [{ type: "paragraph", markdown: "Caché" }] },
    ]))).toEqual(["Caché"]);
  });

  it("ignore les médias et les renvois de navigation", () => {
    expect(blocksToMarkdown([
      { type: "image", image: "https://exemple/x.png" },
      { type: "reference", markdown: "voir ailleurs" },
      { type: "video" },
      { type: "hr" },
    ])).toBe("");
  });

  it("affiche un type inconnu porteur de texte plutôt que de le perdre", () => {
    expect(slidesOf(blocksToMarkdown([{ type: "nouveauType", markdown: "Du texte" }])))
      .toEqual(["Du texte"]);
  });

  it("descend dans un type inconnu sans texte propre", () => {
    expect(slidesOf(blocksToMarkdown([
      { type: "nouvelleEnveloppe", items: [{ type: "paragraph", markdown: "Dedans" }] },
    ]))).toEqual(["Dedans"]);
  });

  it("tolère l'absence de blocs", () => {
    expect(blocksToMarkdown([])).toBe("");
    expect(blocksToMarkdown(undefined as any)).toBe("");
    expect(blocksToMarkdown([null, undefined] as any)).toBe("");
  });

  it("n'émet pas de diapo vide", () => {
    expect(blocksToMarkdown([
      { type: "paragraph", markdown: "" },
      { type: "paragraph", markdown: "   " },
    ])).toBe("");
  });
});

describe("dates du livret", () => {
  it("convertit jj/mm/aaaa en ISO", () => {
    expect(isoDate("26/09/2026")).toBe("2026-09-26");
  });

  it("refuse une forme inattendue au lieu de deviner", () => {
    for (const v of ["2026-09-26", "6/9/2026", "", undefined]) {
      expect(isoDate(v)).toBeNull();
    }
  });

  it("formate un intervalle lisible", () => {
    expect(dateRange("26/09/2026", "02/10/2026")).toMatch(/26.*→.*2/);
  });

  it("renvoie une chaîne vide si une date manque", () => {
    expect(dateRange(undefined, "02/10/2026")).toBe("");
    expect(dateRange("26/09/2026", "pas une date")).toBe("");
  });

  it("borne l'intervalle inclusivement", () => {
    // Le jour même doit compter, aux deux extrémités : une leçon qui commence
    // aujourd'hui est « en cours ».
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const today = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
    expect(coversToday(today, today)).toBe(true);
    expect(coversToday("01/01/2000", "02/01/2000")).toBe(false);
    expect(coversToday(undefined, undefined)).toBe(false);
  });
});

describe("langues", () => {
  it("préfère l'endonyme au nom anglais", () => {
    expect(buildLanguage("mg", "Malagasy").label).toBe("Malagasy");
    expect(buildLanguage("zh", "Chinese").label).toBe("中文");
    expect(buildLanguage("zh", "Chinese").name).toBe("Chinese");
  });

  it("retombe sur le nom de l'API pour un code inconnu", () => {
    const lang = buildLanguage("xyz", "Langue nouvelle");
    expect(lang.label).toBe("Langue nouvelle");
    // Pas de drapeau arbitraire pour une langue qu'on ne sait pas situer.
    expect(lang.flag).toBe("");
  });

  it("retombe sur le code quand tout manque", () => {
    expect(buildLanguage("xyz").label).toBe("XYZ");
  });

  it("épingle mg, fr, en en tête sans perdre les autres", () => {
    const list = ["es", "en", "zu", "mg", "fr"].map((c) => buildLanguage(c));
    expect(sortLanguages(list).map((l) => l.code).slice(0, 3)).toEqual(["mg", "fr", "en"]);
    expect(sortLanguages(list)).toHaveLength(5);
  });

  it("cherche sur l'endonyme, le nom anglais et le code", () => {
    const list = ["mg", "fr", "de", "zh"].map((c) => buildLanguage(c, {
      mg: "Malagasy", fr: "French", de: "German", zh: "Chinese",
    }[c]));
    expect(filterLanguages(list, "mala").map((l) => l.code)).toEqual(["mg"]);
    expect(filterLanguages(list, "german").map((l) => l.code)).toEqual(["de"]);
    expect(filterLanguages(list, "ZH").map((l) => l.code)).toEqual(["zh"]);
    expect(filterLanguages(list, "中文").map((l) => l.code)).toEqual(["zh"]);
  });

  it("rend toute la liste pour une recherche vide", () => {
    const list = ["mg", "fr"].map((c) => buildLanguage(c));
    expect(filterLanguages(list, "  ")).toHaveLength(2);
  });

  it("compare sans accent ni apostrophe", () => {
    expect(normalizeLabel("Lesona Lehibe")).toBe("lesona lehibe");
    expect(normalizeLabel("Asan'ny  Apostoly")).toBe("asan ny apostoly");
    expect(normalizeLabel("Élève")).toBe("eleve");
  });
});
