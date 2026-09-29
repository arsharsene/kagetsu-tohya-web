# 歌月十夜 — Kagetsu Tohya (Web Edition)

A 100% static, client-side web port of the TYPE-MOON visual novel **Kagetsu Tohya (歌月十夜)**, powered by a custom NScripter/ONScripter interpreter written in pure JavaScript (HTML5 Canvas + Web Audio API).

Runs out-of-the-box in modern desktop and mobile browsers, ready for zero-configuration deployment to Vercel, Cloudflare Pages, Netlify, GitHub Pages, or any static web host without requiring a backend or database.

---

## 🌟 Key Features

- **Pure Client-Side & Static:** The entire engine runs in the browser via vanilla JavaScript (`vm.js` + `ui.js`) — no server runtime or Node.js backend required.
- **Full Original Script Compatibility:** Executes the authentic NScripter story script with the English fan translation patch (Lunacy v0.5.x) without alterations to scenario logic.
- **Multiple Display Modes:**
  - *Widescreen* (default) — Adapts widescreen displays with letterboxed ambient extension while keeping proper aspect proportions.
  - *4:3 + Ambient Blur* — Classic 4:3 presentation surrounded by a dynamic, color-responsive ambient glow canvas sampled from the current scene.
  - *Stretch* — Stretches to fill the entire viewport.
- **Complete Audio System:** Looping background music (CD audio tracks in MP3), sound effects (WAV converted to MP3), volume/mute controls, and mobile audio unlock handling.
- **Save & Load System:**
  - 20 save slots persisted in the browser's `localStorage`.
  - Displays timestamps and preview text snippets for each slot.
  - Global variable persistence (`gloval.sav` format) tracking scenario completion, flags, and route unlocks.
- **Navigation & QoL Controls:** Auto-read mode, instant skip / hold-to-skip, backlog / text history lookback, and a toggleable Quick Bar.
- **Mobile-Friendly & Responsive:** UI controls dynamically adapt between mobile devices (portrait & landscape) and desktop layouts.
- **Adult Content Filter Toggle:** Optional toggle at initial launch to automatically skip erotic scenes.
- **Interactive Flowchart:** Direct access to the bundled route walkthrough (*bonus/Kagetsu Tohya Flowchart.pdf*) from the in-game menu.

---

## 🎮 Controls & Shortcuts

### Desktop (Keyboard & Mouse)

| Action | Keyboard | Mouse |
| :--- | :--- | :--- |
| **Advance Text** | <kbd>Enter</kbd> / <kbd>Space</kbd> / <kbd>→</kbd> / <kbd>↓</kbd> | Left Click on screen / Scroll Down |
| **Open Menu** | <kbd>Esc</kbd> | Right Click / ☰ Menu button |
| **Text History (Log)** | <kbd>L</kbd> / <kbd>↑</kbd> / <kbd>Page Up</kbd> | Scroll Wheel Up / *Log* button |
| **Toggle Auto-Play** | <kbd>A</kbd> | *Auto* button on Quick Bar |
| **Toggle Skip** | <kbd>S</kbd> | *Skip* button on Quick Bar |
| **Fast Forward (Hold)** | Hold <kbd>Ctrl</kbd> | — |
| **Toggle Fullscreen** | <kbd>F</kbd> | ⛶ button on Quick Bar |
| **Cancel / Back** | <kbd>Esc</kbd> | Right Click / ↩ *Back* button |

### Mobile & Touch Devices

- **Tap Screen:** Advance text / select choice.
- **☰ Button:** Toggle the Quick Bar and navigation overlay.
- **Quick Bar:** Direct access to Log, Auto, Skip, Save, Load, Fullscreen, and Mute audio.

---

## 🚀 Running Locally

Because the engine fetches game scripts (`script.txt`) and media assets via the `fetch()` API, opening `index.html` directly using the `file:///` protocol will be blocked by browser CORS security policies. Use any local HTTP server:

### Option 1: Node.js / npx (Recommended)
```bash
# Using 'serve'
npx serve public

# Or using 'http-server'
npx http-server public -p 3000
```

### Option 2: Python
```bash
# Python 3
python -m http.server 8000 --directory public
```

### Option 3: VS Code Extension
Install the **Live Server** extension in Visual Studio Code, right-click `public/index.html`, and select **"Open with Live Server"**.

Then open the generated local address (typically `http://localhost:3000` or `http://localhost:8000`) in your browser.

---

## 🌐 Deployment Guide

### 1. Vercel (Ready out-of-the-box)
This repository includes a preconfigured `vercel.json` with static asset caching headers and search crawler indexing protection.

```bash
# Install Vercel CLI (if not already installed)
npm i -g vercel

# Deploy directly to production
vercel --prod
```
> **Note:** The output directory is preset to `public`. No build step (`npm run build`) is needed.

### 2. Cloudflare Pages / Netlify / GitHub Pages
- **Build Command:** *(leave empty)*
- **Build Output Directory:** `public`

---

## ⚙️ Configuration (`public/config.js`)

If you want to host large media assets on an external CDN or Object Storage bucket (e.g. AWS S3, Cloudflare R2, Supabase Storage) to bypass Git or hosting bandwidth limitations:

Edit `public/config.js`:
```javascript
/* Set base to a CDN/bucket URL (ending with "/") if you host the media outside of Vercel. */
window.KT_CONFIG = {
  // Replace with your external CDN URL (must end with '/')
  // Example: 'https://cdn.example.com/assets/'
  base: 'a/',

  script: 'game/script.txt',
  maxScale: 4,
  tracks: [2, 17],
  seedFile: 'game/seed.json',

  /* 
     seed: true pre-loads the progress from the bundled save (gloval.sav) into every
     new visitor's browser — suitable for a personal single-user deployment.
     Keep this false for public deployments so each visitor starts with fresh progress.
  */
  seed: false
};
```

---

## 📁 Directory Structure

```text
kagetsu-tohya-web/
├── package.json          # Project metadata
├── vercel.json           # Vercel deployment routing, caching, and robots headers
├── README.md             # Project documentation
└── public/               # Static web root directory
    ├── index.html        # HTML shell & bootstrap UI
    ├── config.js         # Runtime configuration (CDN paths, seed settings)
    ├── icon.png          # App icon / favicon
    ├── robots.txt        # Search engine crawler disallow directive
    ├── css/
    │   └── style.css     # UI stylesheet, canvas scaling, and ambient lighting
    ├── js/
    │   ├── vm.js         # NScripter bytecode/command virtual machine interpreter
    │   └── ui.js         # Canvas rendering, user input, Web Audio API, & menus
    ├── game/
    │   ├── script.txt    # Game script extracted from original nscript.dat
    │   └── seed.json     # Initial global completion state (gloval.sav as JSON)
    ├── bonus/
    │   └── Kagetsu Tohya Flowchart.pdf  # Route & scenario progression guide
    └── a/                # Game media assets (can be hosted on an external CDN)
        ├── font.woff2    # Game typography font
        ├── cd/           # Background music (track02 - track17 in .mp3)
        ├── image/        # Backgrounds, sprites (tachi-e), and CGs (.webp)
        └── wave/         # Sound effects (.mp3)
```

---

## 🛠️ Asset Processing & Conversion

Original PC release assets (`nscript.dat`, `arc.nsa`, `arc1.nsa`, CD audio) are optimized for the web:
- **Images:** `JPG` and `BMP` files are converted to modern `WebP`. Masked character sprites and overlays are pre-composited into WebP with transparency (*alpha channel*) to drastically reduce payload sizes and canvas rendering overhead.
- **Audio:** CD Audio (`OGG`) and sound effects (`WAV`) are re-encoded to `MP3` for broad, zero-dependency browser compatibility.

---

## ⚖️ Disclaimer & Copyright Notice

- This project is a non-commercial fan-made web port created for preservation and personal convenience.
- **Kagetsu Tohya (歌月十夜)** is copyright © **TYPE-MOON**.
- The English script translation is by the Lunacy translation team et al.
- All intellectual property, story, and assets belong to their respective copyright holders. **Do not sell or commercialize this software.**

