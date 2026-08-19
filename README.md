# MyProjector

Logiciel de projection pour les cultes : chants, versets bibliques, méditations,
documents, vidéos et diapos Markdown, sur un second écran.

Construit avec **Tauri 2 + React 19 + TypeScript**. Cible principale : **Linux**
(WebKitGTK) ; Windows et macOS sont construits par la CI.

---

## Documentation

Quatre documents, à lire selon le besoin :

| Document | Quand l'ouvrir |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Comprendre comment l'application est faite, où vivent les données, pourquoi certains choix bizarres sont volontaires |
| [docs/RELEASE.md](docs/RELEASE.md) | Publier une nouvelle version, gérer les clés de signature et la mise à jour automatique |
| [docs/BIBLIOTHEQUE.md](docs/BIBLIOTHEQUE.md) | Ajouter ou corriger des contenus téléchargeables (documents, audio, Mofon'aina) |
| [docs/DEPANNAGE.md](docs/DEPANNAGE.md) | Quelque chose ne marche pas sur une machine d'utilisateur |

---

## Fonctionnalités

**Contenus**
- Bible avec recherche par référence (`Jean 3:16`, `1Jao.3.16`, `Gen 1`)
- Recueils de chants, recherche plein texte et par numéro
- Agenda (ordre du culte) : chants, versets, textes libres, Markdown, images,
  vidéos, audio, PDF, YouTube, liens web
- Bibliothèque téléchargeable : documents PDF, playbacks des cantiques,
  méditations Mofon'aina — **tout est optionnel**, rien n'est imposé

**Projection**
- Fenêtre de projection indépendante, plein écran sur le second moniteur
- Aperçu opérateur, horloge, bandeau défilant, écran noir / blanc, masquage
- Fonds image ou vidéo (lecture automatique en boucle)
- Caméra en arrière-plan
- Audio associé : playback d'un cantique, chapitre de la Bible malgache

**Autour**
- Télécommande depuis un téléphone sur le même réseau Wi-Fi
- Historique des chants projetés, sauvegarde du profil
- Check système (codecs, écrans, serveur média, espace disque)
- Mise à jour proposée automatiquement, jamais imposée

Raccourcis clavier : dans l'application, **Bibliothèque → Raccourcis**.

---

## Démarrer

### Prérequis

- [Node.js](https://nodejs.org/) LTS
- [Rust](https://www.rust-lang.org/) via rustup
- Sur Debian / Ubuntu / Linux Mint :

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libappindicator3-dev librsvg2-dev patchelf \
  gstreamer1.0-libav gstreamer1.0-plugins-good gstreamer1.0-plugins-bad
```

`gstreamer1.0-libav` n'est pas optionnel : sans lui, **aucune vidéo H.264 ne se
lit**. Voir [docs/DEPANNAGE.md](docs/DEPANNAGE.md).

### Développer

```bash
npm install
npm run tauri dev
```

### Construire localement

```bash
npm run build:app        # .deb, .rpm et AppImage dans src-tauri/target/release/bundle/
```

Pas `npm run tauri build` directement : depuis la mise en place des mises à
jour, tauri exige la clé privée de signature. `build:app` la fournit
automatiquement depuis `~/.myprojector-keys/`.

### Publier une version

```bash
npm run release 0.2.0    # versionne, tag, pousse → la CI construit les 3 systèmes
```

Détails complets, y compris les clés de signature :
[docs/RELEASE.md](docs/RELEASE.md).

---

## Organisation du dépôt

```
src/                    Interface React
  components/           Composants d'écran
    library/            Bibliothèque plein écran (une section par fichier)
  lib/                  Logique pure et ponts vers Rust
  data/                 Données embarquées (carte audio de la Bible)
src-tauri/
  src/lib.rs            Tout le backend Rust : commandes, serveur média, télécommande
  data/                 Bibles et recueils livrés avec l'application
  capabilities/         Permissions Tauri (à élargir avec parcimonie)
  tauri.conf.json       Configuration, CSP, bundle, mise à jour
scripts/release.mjs     Script de publication
.github/workflows/      Construction multi-plateforme
docs/                   Cette documentation
```

---

## Licence

Usage communautaire et ecclésial.
