# MyProjector - Solution de Projection Professionnelle

MyProjector est une application moderne développée avec **Tauri, React et TypeScript**, conçue spécialement pour la projection de paroles (chants, recueils) et de versets bibliques pendant les services et événements.

## 🚀 Fonctionnalités Clés

### 📖 Gestion de Contenu
- **Bible Intégrée** : Recherche rapide par référence (ex: `Jean 3:16`) avec défilement automatique vers le verset sélectionné.
- **Recueils de Chants** : Organisation par livres et recherche plein texte.
- **Agenda / Playlist** : Préparez votre ordre de service à l'avance.

### 📽️ Projection & Live
- **Double Écran** : Contrôle indépendant entre l'interface opérateur et l'écran de projection (mode Plein Écran automatique).
- **Aperçu en Temps Réel** : Visualisez ce qui est projeté ou ce qui va l'être.
- **Mode Caméra** : Intégration de flux caméra en arrière-plan (Incrustation).
- **Cacher le Contenu** : Masquez/Affichez le texte instantanément (Fonction "Freeze").

### 🎨 Personnalisation visuelle
- **Médiathèque Permanente** : Importez vos propres images et vidéos. L'application les copie dans un dossier interne pour garantir leur disponibilité.
- **Styles Dynamiques** : Modifiez la police, la taille, l'alignement et l'interligne individuellement ou par catégorie.
- **Fonds Vidéo** : Support des formats MP4, WebM, etc., avec lecture fluide en boucle.

### ➕ Fonctionnalités "Projection Plus"
- **Horloge Personnalisable** : Affichage numérique ou analogique avec réglage de la taille, de la couleur et de la position.
- **Message Défilant (Marquee)** : Bandes d'informations défilantes avec contrôle de la vitesse, de l'opacité du fond et de la police.

## 🛠️ Installation & Développement

### Prérequis
- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/) (via rustup)
- Dépendances Tauri (voir la [documentation officielle](https://tauri.app/v1/guides/getting-started/prerequisites))

### Lancer en développement
```bash
npm install
npm run tauri dev
```

### Compiler l'application
```bash
npm run tauri build
```

## 📂 Architecture
- `src/` : Frontend React + TailwindCSS.
- `src-tauri/` : Backend Rust gérant le système de fichiers, la base de données SQLite et les fenêtres natives.
- `data/` : Dossier contenant les bases de données (bible, hymnes) et les médias importés.

## 📄 Licence
Ce projet est destiné à un usage communautaire et ecclésial.
