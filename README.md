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
| Word export | One click turns the LaTeX project into an editable Word document (.docx) for people who do not use LaTeX: cover, contents, chapters on new pages, numbered figures and tables, working cross references, editable Word equations, citations and the reference list, with a Page X of Y footer. Can update the Word file after every compile. Uses the bundled Pandoc |
| Live co-editing | Share button starts a session on the office network; others join with the address and code. Everyone edits the same files at once with coloured cursors, presence and synced comments, and each PC compiles its own PDF |
| Code and Visual editor | The Code / Visual switch above the editor (Ctrl+Shift+V) changes how the same file is shown. Visual shows headings, bold, italics, lists and citations the way they read, and dims the preamble; the line the cursor is on shows its real code, so nothing in the file changes and everything stays editable |
| Layout | Layout button: split view, editor only, PDF only, the PDF in its own window (updates after each compile), and focus mode with only the text on screen (Ctrl+Shift+M, Esc to leave) |
| Share dialog | Share button: invite people by email, turn live sharing on or off, see who is in the session, copy the sharing details, or send a copy (PDF, Word, ZIP). Live sharing is between PCs on the same network |
| Help | Help button and menu: searchable keyboard shortcuts (F1), documentation, contact us |
| AI Build chat | Type what you want in the prompt box under the editor (Ctrl+K) or in the AI panel, and the AI changes the project itself: it reads every project file, writes or edits sections, tables, equations and new files, then compiles and corrects its own compile errors. Each answer lists the files it changed with Review (accept or reject each change) and Undo all, and a version from before is saved in History. "Build with AI" on the Dashboard starts a new project from a description |
| AI literature search | Ask the Build chat to "find papers on ..." or to write related work: it searches arXiv, shows the papers it found, cites only those, and adds their BibTeX to the project's .bib file. The References panel has the same arXiv search with one-click "Add to project". Only the search words are sent to arxiv.org, and Datex asks before the first AI search |
| Picture to LaTeX | Attach or paste a photo of a whiteboard, a handwritten equation or a screenshot of a table in the AI panel, and the AI writes it into the document as LaTeX (equations, tables, TikZ). Needs a vision model: Claude (cloud), or a local model that supports pictures |
| AI: local or cloud | The AI runs on local Ollama models by default, so documents never leave the PC. In the AI panel you can switch to Claude (cloud) with your own Anthropic API key for faster and more accurate results; each request then sends the text of the project files to Anthropic. The key is stored encrypted on the PC |
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
- `lib/`: LaTeX log parser, BibTeX reader, SyncTeX reader, arXiv search (tested in `tests/`)
- `renderer/`: the window (`index.html`, `styles.css`, `app.js`, `data.js`)
- `renderer/aibuild.js`: the AI Build chat engine (project context, edit blocks, applying edits; tested in `tests/aibuild.test.mjs`)
- `templates/`: new project templates
- `templates/word/`: Word export template, filter and numbered citation style
- `tools/`: engine and Pandoc download, package cache and Word template scripts

Each project is a normal folder. Datex keeps its build output in `.datex/build`, comments in `.datex/comments.json` and history in the project's own Git repository.

## Roadmap

- Live sessions over the internet through a hosted relay server
- Code signing for the installer
- More dictionaries and templates
