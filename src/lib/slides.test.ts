import { describe, expect, it } from "vitest";
import {
  getSlide, getSlides, isMarkdown, splitLongSlide, withSplitDefaults,
} from "./slides";

describe("getSlides — chants et textes", () => {
  it("découpe sur les lignes vides, une strophe par écran", () => {
    expect(getSlides({ lyrics: "Strophe 1\nligne 2\n\nStrophe 2" })).toEqual([
      "Strophe 1\nligne 2",
      "Strophe 2",
    ]);
  });

  it("renvoie toujours au moins une diapo", () => {
    // Un élément vide ne doit pas produire un tableau vide : l'index de diapo
    // courant pointerait dans le vide et la projection se figerait.
    expect(getSlides({ lyrics: "" })).toEqual([""]);
    expect(getSlides({})).toEqual([""]);
    expect(getSlides(null)).toEqual([""]);
    expect(getSlides({ lyrics: "   \n  " })).toEqual([""]);
  });

  it("tolère plusieurs lignes vides d'affilée", () => {
    expect(getSlides({ lyrics: "A\n\n\n\nB" })).toEqual(["A", "B"]);
  });
});

describe("getSlides — Markdown", () => {
  const md = (lyrics: string) => ({ type: "markdown", lyrics });

  it("découpe sur les barres horizontales, pas sur les lignes vides", () => {
    const slides = getSlides(md("# Titre\n\nUn paragraphe\n\n---\n\nSuite"));
    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain("Un paragraphe");
    expect(slides[1]).toBe("Suite");
  });

  it("accepte les trois graphies de séparateur", () => {
    for (const sep of ["---", "***", "___", "-----"]) {
      expect(getSlides(md(`A\n\n${sep}\n\nB`))).toHaveLength(2);
    }
  });

  it("ne recoupe jamais une diapo Markdown", () => {
    // Elles sont découpées à la main par l'auteur : les recouper casserait
    // une mise en page voulue.
    const long = "x".repeat(2000);
    const slides = getSlides(md(long), { enabled: true, maxChars: 100 });
    expect(slides).toEqual([long]);
  });

  it("retombe sur le texte brut quand il n'y a aucun séparateur", () => {
    expect(getSlides(md("Juste un bloc"))).toEqual(["Juste un bloc"]);
  });

  it("reconnaît le type", () => {
    expect(isMarkdown({ type: "markdown" })).toBe(true);
    expect(isMarkdown({ type: "text" })).toBe(false);
    expect(isMarkdown(null)).toBe(false);
  });
});

describe("découpage automatique des diapos trop longues", () => {
  it("est désactivé par défaut", () => {
    // Et volontairement : découper change la numérotation des diapos, qu'un
    // opérateur connaît par cœur.
    expect(withSplitDefaults().enabled).toBe(false);
    const long = "Phrase une. ".repeat(40);
    expect(getSlides({ lyrics: long })).toHaveLength(1);
  });

  it("borne une longueur aberrante", () => {
    // En dessous de 80 on couperait des phrases courtes en deux.
    expect(withSplitDefaults({ maxChars: 1 }).maxChars).toBe(80);
    expect(withSplitDefaults({ maxChars: 99999 }).maxChars).toBe(900);
  });

  it("laisse tel quel ce qui tient déjà", () => {
    expect(splitLongSlide("court", 100)).toEqual(["court"]);
  });

  it("coupe en préférant une fin de phrase", () => {
    const parts = splitLongSlide("Première phrase. Deuxième phrase.", 20);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("Première phrase.");
    expect(parts[1]).toBe("Deuxième phrase.");
  });

  it("ne coupe jamais au milieu d'un mot", () => {
    const mot = "a".repeat(300);
    expect(splitLongSlide(mot, 50)).toEqual([mot]);
  });

  it("recoupe tant que nécessaire, sans perdre de texte", () => {
    const texte = "Un. Deux. Trois. Quatre. Cinq. Six. Sept. Huit.";
    const parts = splitLongSlide(texte, 15);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join(" ")).toBe(texte);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(15 + 10);
  });

  it("s'applique aux chants quand il est activé", () => {
    // Une strophe de ~200 caractères avec un seuil à 80 : elle doit donner
    // plusieurs écrans, et chaque strophe reste traitée indépendamment.
    const strophe = "Chantons la gloire du Seigneur. Il est bon envers nous. "
      + "Sa fidélité demeure. Nous le louerons sans fin.";
    const slides = getSlides({ lyrics: strophe }, { enabled: true, maxChars: 80 });
    expect(slides.length).toBeGreaterThan(1);
    expect(slides.join(" ")).toBe(strophe);
  });
});

describe("getSlide", () => {
  const song = { lyrics: "A\n\nB\n\nC" };

  it("renvoie la diapo demandée", () => {
    expect(getSlide(song, 1)).toBe("B");
  });

  it("borne l'index au lieu de sortir du tableau", () => {
    // Le cas réel : on supprime des strophes pendant que la projection est en
    // cours, et l'index courant dépasse.
    expect(getSlide(song, 99)).toBe("C");
    expect(getSlide(song, -5)).toBe("A");
  });
});
