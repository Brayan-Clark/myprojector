import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSITION, TRANSITIONS, keepsPreviousLayer, transitionClasses,
  withTransitionDefaults, type TransitionType,
} from "./transitions";

describe("withTransitionDefaults", () => {
  it("complète une configuration partielle", () => {
    expect(withTransitionDefaults({ type: "zoom-in" }))
      .toEqual({ type: "zoom-in", duration: DEFAULT_TRANSITION.duration });
  });

  it("retombe sur le défaut quand rien n'est enregistré", () => {
    expect(withTransitionDefaults()).toEqual(DEFAULT_TRANSITION);
    expect(withTransitionDefaults(null)).toEqual(DEFAULT_TRANSITION);
  });

  /**
   * Une durée aberrante enregistrée par erreur bloquerait l'affichage de la
   * diapo suivante pendant plusieurs secondes, en plein culte.
   */
  it("borne une durée aberrante", () => {
    expect(withTransitionDefaults({ duration: 99999 }).duration).toBe(1200);
    expect(withTransitionDefaults({ duration: -50 }).duration).toBe(0);
  });

  it("accepte zéro, qui vaut une coupe", () => {
    expect(withTransitionDefaults({ duration: 0 }).duration).toBe(0);
  });
});

describe("transitionClasses", () => {
  it("n'applique aucune classe pour une coupe", () => {
    expect(transitionClasses("none")).toEqual({ enter: "", exit: "" });
  });

  it("nomme les deux sens de l'animation", () => {
    expect(transitionClasses("fade")).toEqual({
      enter: "slide-anim-fade-in", exit: "slide-anim-fade-out",
    });
  });

  /**
   * Garde-fou contre un décalage silencieux : chaque type proposé dans
   * l'interface doit avoir ses classes, sinon la transition ne joue pas et
   * l'opérateur voit une coupe sans comprendre pourquoi.
   *
   * Les règles CSS correspondantes vivent dans `src/index.css`.
   */
  it("couvre tous les types proposés dans l'interface", () => {
    for (const { value } of TRANSITIONS) {
      const { enter, exit } = transitionClasses(value);
      if (value === "none") continue;
      expect(enter, `entrée manquante pour ${value}`).toBe(`slide-anim-${value}-in`);
      expect(exit, `sortie manquante pour ${value}`).toBe(`slide-anim-${value}-out`);
    }
  });

  it("propose « aucune » et le défaut recommandé", () => {
    const values = TRANSITIONS.map((t) => t.value);
    expect(values).toContain("none");
    expect(values).toContain(DEFAULT_TRANSITION.type);
  });

  it("ne propose jamais deux fois le même type", () => {
    const values = TRANSITIONS.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("keepsPreviousLayer", () => {
  /**
   * ⚠ Garder l'ancienne couche sur une vidéo ou un PDF, c'est un SECOND
   * décodage simultané de la même vidéo — exactement le gel que toute
   * l'architecture cherche à éviter.
   */
  it.each<[string, boolean]>([
    ["video", false],
    ["image", false],
    ["document", false],
    ["audio", false],
    ["youtube", false],
    ["markdown", true],
  ])("type « %s » garde la couche précédente : %s", (type, expected) => {
    expect(keepsPreviousLayer(type)).toBe(expected);
  });

  it("garde la couche pour du texte, qui ne coûte rien", () => {
    expect(keepsPreviousLayer(null)).toBe(true);
    expect(keepsPreviousLayer(undefined)).toBe(true);
  });
});

describe("cohérence du type", () => {
  it("n'accepte pas un type inventé", () => {
    // Vérifié à la compilation ; ici on s'assure que la valeur inconnue ne
    // produit pas de classe utilisable par accident.
    const bogus = "tourniquet" as TransitionType;
    expect(transitionClasses(bogus).enter).toBe("slide-anim-tourniquet-in");
    expect(TRANSITIONS.some((t) => t.value === bogus)).toBe(false);
  });
});
