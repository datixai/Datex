# Datex

A complete LaTeX writing studio for Windows 10 and 11. Editor, TeX engine, PDF viewer and Overleaf-style professional tools in one installable app.

Developed by **Datix AI** · [datixai.com](https://datixai.com)

## What is inside

| Area | Features |
|---|---|
| Editor (WinEdt style) | LaTeX syntax colours, autocomplete for commands, environments, `\cite` keys, `\ref` labels, image and file names, formatting toolbar, find and replace, multiple tabs, outline, spell check (UK or US English) with quick fixes, word count |
| TeX engine (MiKTeX style) | Built-in engine (Tectonic) ships in the installer, so nothing else is needed. Common packages come pre-cached; any other package downloads automatically the first time it is used. Uses MiKTeX or TeX Live through latexmk for pdfLaTeX, XeLaTeX or LuaLaTeX if one is installed |
| PDF viewer (WinEdt PDF style) | Built-in viewer, zoom, fit width, page counter, export. SyncTeX both ways: double-click the PDF to jump to the source, Ctrl+Alt+J to jump from the source to the PDF |
| Overleaf paid-tier features | Auto compile while typing, no compile time limit, full project history with labelled versions, compare and restore, track changes (accept or reject each change), comments with replies and resolve, Git and GitHub sync, Zotero import, add references by DOI, advanced reference search, symbol palette, templates |
| AI (local) | Fix compile errors, improve writing, fix grammar, shorten, explain, make tables, equations and TikZ diagrams, draft an abstract, suggest titles, translate. Runs with local Ollama models, so documents never leave the PC |

Templates: Blank, Article, Report, Thesis (multi-file), IEEE Conference, Presentation (Beamer), CV, Letter.

## Run in development

```powershell
npm install
npm start
```

## Build the installer

```powershell
npm run dist
```

This runs the tests, downloads the Tectonic engine into `bin/`, pre-fills `tex-cache/` with the packages used by the templates and the common package list (`templates/packages.tex`), then builds `dist/Datex Setup <version>.exe` (NSIS, x64, Windows 10 and 11).

## Project layout

- `main.js`: main process (projects, files, compile, SyncTeX, history, Git, references, AI, spell check)
- `preload.js`: safe bridge to the window
- `lib/`: LaTeX log parser, BibTeX reader, SyncTeX reader (tested in `tests/`)
- `renderer/`: the window (`index.html`, `styles.css`, `app.js`, `data.js`)
- `templates/`: new project templates
- `tools/`: engine download and package cache scripts

Each project is a normal folder. Datex keeps its build output in `.datex/build`, comments in `.datex/comments.json` and history in the project's own Git repository.

## Roadmap

- Real-time co-editing over the office network and a self-hosted sync server
- Code signing for the installer
- More dictionaries and templates
