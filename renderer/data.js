// Static data for Datex: command completions, environments, symbols and AI actions.

// [label, snippet, description]
export const LATEX_COMMANDS = [
  ['\\documentclass', '\\documentclass[${1:12pt}]{${2:article}}', 'Document class'],
  ['\\usepackage', '\\usepackage{${1}}', 'Load a package'],
  ['\\usepackage[]', '\\usepackage[${2}]{${1}}', 'Load a package with options'],
  ['\\title', '\\title{${1}}', ''], ['\\author', '\\author{${1}}', ''], ['\\date', '\\date{${1:\\today}}', ''],
  ['\\maketitle', '\\maketitle', ''], ['\\tableofcontents', '\\tableofcontents', ''], ['\\listoffigures', '\\listoffigures', ''], ['\\listoftables', '\\listoftables', ''],
  ['\\part', '\\part{${1}}', ''], ['\\chapter', '\\chapter{${1}}', ''], ['\\section', '\\section{${1}}', ''], ['\\section*', '\\section*{${1}}', ''],
  ['\\subsection', '\\subsection{${1}}', ''], ['\\subsubsection', '\\subsubsection{${1}}', ''], ['\\paragraph', '\\paragraph{${1}}', ''],
  ['\\textbf', '\\textbf{${1}}', 'Bold'], ['\\textit', '\\textit{${1}}', 'Italic'], ['\\emph', '\\emph{${1}}', 'Emphasis'], ['\\underline', '\\underline{${1}}', ''],
  ['\\texttt', '\\texttt{${1}}', 'Monospace'], ['\\textsc', '\\textsc{${1}}', 'Small caps'], ['\\textsf', '\\textsf{${1}}', ''], ['\\textcolor', '\\textcolor{${1:red}}{${2}}', 'Needs xcolor'],
  ['\\footnote', '\\footnote{${1}}', ''], ['\\label', '\\label{${1}}', ''], ['\\ref', '\\ref{${1}}', ''], ['\\eqref', '\\eqref{${1}}', ''], ['\\pageref', '\\pageref{${1}}', ''],
  ['\\autoref', '\\autoref{${1}}', 'Needs hyperref'], ['\\cref', '\\cref{${1}}', 'Needs cleveref'],
  ['\\cite', '\\cite{${1}}', ''], ['\\citep', '\\citep{${1}}', 'natbib'], ['\\citet', '\\citet{${1}}', 'natbib'], ['\\parencite', '\\parencite{${1}}', 'biblatex'], ['\\textcite', '\\textcite{${1}}', 'biblatex'],
  ['\\bibliography', '\\bibliography{${1:references}}', ''], ['\\bibliographystyle', '\\bibliographystyle{${1:plain}}', ''], ['\\addbibresource', '\\addbibresource{${1:references.bib}}', 'biblatex'], ['\\printbibliography', '\\printbibliography', 'biblatex'],
  ['\\includegraphics', '\\includegraphics[width=${1:0.8}\\linewidth]{${2}}', 'Needs graphicx'],
  ['\\caption', '\\caption{${1}}', ''], ['\\centering', '\\centering', ''], ['\\item', '\\item ${1}', ''],
  ['\\input', '\\input{${1}}', ''], ['\\include', '\\include{${1}}', ''],
  ['\\href', '\\href{${1:url}}{${2:text}}', 'Needs hyperref'], ['\\url', '\\url{${1}}', ''],
  ['\\newcommand', '\\newcommand{\\\\${1:name}}[${2:1}]{${3}}', ''], ['\\renewcommand', '\\renewcommand{\\\\${1:name}}{${2}}', ''],
  ['\\newpage', '\\newpage', ''], ['\\clearpage', '\\clearpage', ''], ['\\noindent', '\\noindent', ''], ['\\vspace', '\\vspace{${1:1em}}', ''], ['\\hspace', '\\hspace{${1:1em}}', ''],
  ['\\linewidth', '\\linewidth', ''], ['\\textwidth', '\\textwidth', ''], ['\\today', '\\today', ''], ['\\hline', '\\hline', ''],
  ['\\toprule', '\\toprule', 'booktabs'], ['\\midrule', '\\midrule', 'booktabs'], ['\\bottomrule', '\\bottomrule', 'booktabs'], ['\\multicolumn', '\\multicolumn{${1:2}}{${2:c}}{${3}}', ''],
  ['\\frac', '\\frac{${1}}{${2}}', 'Fraction'], ['\\dfrac', '\\dfrac{${1}}{${2}}', ''], ['\\sqrt', '\\sqrt{${1}}', ''], ['\\sum', '\\sum_{${1:i=1}}^{${2:n}}', ''], ['\\prod', '\\prod_{${1:i=1}}^{${2:n}}', ''],
  ['\\int', '\\int_{${1:a}}^{${2:b}}', ''], ['\\lim', '\\lim_{${1:x \\to \\infty}}', ''], ['\\left(', '\\left( ${1} \\right)', ''], ['\\left[', '\\left[ ${1} \\right]', ''],
  ['\\mathbf', '\\mathbf{${1}}', ''], ['\\mathrm', '\\mathrm{${1}}', ''], ['\\mathbb', '\\mathbb{${1}}', 'Needs amssymb'], ['\\mathcal', '\\mathcal{${1}}', ''], ['\\text', '\\text{${1}}', 'Needs amsmath'],
  ['\\hat', '\\hat{${1}}', ''], ['\\bar', '\\bar{${1}}', ''], ['\\vec', '\\vec{${1}}', ''], ['\\dot', '\\dot{${1}}', ''], ['\\tilde', '\\tilde{${1}}', ''], ['\\overline', '\\overline{${1}}', ''],
  ['\\alpha', '\\alpha', ''], ['\\beta', '\\beta', ''], ['\\gamma', '\\gamma', ''], ['\\delta', '\\delta', ''], ['\\epsilon', '\\epsilon', ''], ['\\theta', '\\theta', ''], ['\\lambda', '\\lambda', ''],
  ['\\mu', '\\mu', ''], ['\\pi', '\\pi', ''], ['\\sigma', '\\sigma', ''], ['\\phi', '\\phi', ''], ['\\omega', '\\omega', ''], ['\\infty', '\\infty', ''], ['\\partial', '\\partial', ''], ['\\nabla', '\\nabla', ''],
  ['\\cdot', '\\cdot', ''], ['\\times', '\\times', ''], ['\\leq', '\\leq', ''], ['\\geq', '\\geq', ''], ['\\neq', '\\neq', ''], ['\\approx', '\\approx', ''], ['\\in', '\\in', ''], ['\\rightarrow', '\\rightarrow', ''],
  ['\\frametitle', '\\frametitle{${1}}', 'Beamer'], ['\\pause', '\\pause', 'Beamer']
];

export const ENVIRONMENTS = ['itemize', 'enumerate', 'description', 'figure', 'figure*', 'table', 'table*', 'tabular', 'tabularx', 'equation', 'equation*', 'align', 'align*', 'gather', 'multline', 'split', 'cases',
  'matrix', 'pmatrix', 'bmatrix', 'array', 'center', 'flushleft', 'flushright', 'quote', 'quotation', 'verbatim', 'lstlisting', 'minted', 'abstract', 'theorem', 'lemma', 'proof', 'definition', 'corollary', 'example', 'remark',
  'frame', 'block', 'columns', 'column', 'minipage', 'subfigure', 'tikzpicture', 'axis', 'algorithm', 'algorithmic', 'thebibliography', 'appendix', 'document', 'titlepage', 'landscape', 'multicols'];

export const SYMBOLS = {
  'Greek': [['α', '\\alpha'], ['β', '\\beta'], ['γ', '\\gamma'], ['δ', '\\delta'], ['ε', '\\epsilon'], ['ζ', '\\zeta'], ['η', '\\eta'], ['θ', '\\theta'], ['ι', '\\iota'], ['κ', '\\kappa'], ['λ', '\\lambda'], ['μ', '\\mu'],
    ['ν', '\\nu'], ['ξ', '\\xi'], ['π', '\\pi'], ['ρ', '\\rho'], ['σ', '\\sigma'], ['τ', '\\tau'], ['υ', '\\upsilon'], ['φ', '\\phi'], ['χ', '\\chi'], ['ψ', '\\psi'], ['ω', '\\omega'], ['ϕ', '\\varphi'],
    ['Γ', '\\Gamma'], ['Δ', '\\Delta'], ['Θ', '\\Theta'], ['Λ', '\\Lambda'], ['Ξ', '\\Xi'], ['Π', '\\Pi'], ['Σ', '\\Sigma'], ['Φ', '\\Phi'], ['Ψ', '\\Psi'], ['Ω', '\\Omega']],
  'Operators': [['±', '\\pm'], ['∓', '\\mp'], ['×', '\\times'], ['÷', '\\div'], ['·', '\\cdot'], ['∘', '\\circ'], ['∑', '\\sum'], ['∏', '\\prod'], ['∫', '\\int'], ['∬', '\\iint'], ['∮', '\\oint'], ['√', '\\sqrt{}'],
    ['∂', '\\partial'], ['∇', '\\nabla'], ['⊕', '\\oplus'], ['⊗', '\\otimes'], ['∪', '\\cup'], ['∩', '\\cap'], ['∧', '\\wedge'], ['∨', '\\vee'], ['¬', '\\neg'], ['⋆', '\\star'], ['†', '\\dagger'], ['lim', '\\lim']],
  'Relations': [['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∼', '\\sim'], ['≃', '\\simeq'], ['∝', '\\propto'], ['≪', '\\ll'], ['≫', '\\gg'], ['∈', '\\in'], ['∉', '\\notin'],
    ['⊂', '\\subset'], ['⊆', '\\subseteq'], ['⊃', '\\supset'], ['⊇', '\\supseteq'], ['∀', '\\forall'], ['∃', '\\exists'], ['∄', '\\nexists'], ['⊥', '\\perp'], ['∥', '\\parallel'], ['≅', '\\cong'], ['⊢', '\\vdash'], ['⊨', '\\models']],
  'Arrows': [['→', '\\rightarrow'], ['←', '\\leftarrow'], ['↔', '\\leftrightarrow'], ['⇒', '\\Rightarrow'], ['⇐', '\\Leftarrow'], ['⇔', '\\Leftrightarrow'], ['↦', '\\mapsto'], ['↑', '\\uparrow'], ['↓', '\\downarrow'],
    ['⟶', '\\longrightarrow'], ['⟹', '\\implies'], ['⟺', '\\iff'], ['↗', '\\nearrow'], ['↘', '\\searrow'], ['⇀', '\\rightharpoonup'], ['↪', '\\hookrightarrow']],
  'Misc': [['∞', '\\infty'], ['∅', '\\emptyset'], ['ℝ', '\\mathbb{R}'], ['ℕ', '\\mathbb{N}'], ['ℤ', '\\mathbb{Z}'], ['ℚ', '\\mathbb{Q}'], ['ℂ', '\\mathbb{C}'], ['ℓ', '\\ell'], ['ℏ', '\\hbar'], ['ℵ', '\\aleph'],
    ['°', '^\\circ'], ['′', '^\\prime'], ['…', '\\ldots'], ['⋯', '\\cdots'], ['⋮', '\\vdots'], ['⋱', '\\ddots'], ['∠', '\\angle'], ['△', '\\triangle'], ['□', '\\square'], ['♠', '\\spadesuit'], ['§', '\\S'], ['¶', '\\P'], ['©', '\\copyright'], ['€', '\\texteuro']]
};

// {sel} selected text, {input} what the user typed, {errors} compile errors with code, {doc} main file
export const AI_ACTIONS = [
  { id: 'fix', label: 'Fix compile errors', hint: 'Explain and fix the current errors', prompt: 'My LaTeX document fails to compile. For each error, explain the cause in one sentence and give the corrected lines.\n{errors}' },
  { id: 'improve', label: 'Improve writing', hint: 'Rewrite the selection', needsSel: true, replace: true, prompt: 'Rewrite this LaTeX text so it is clear, concise and academic. Keep every LaTeX command, citation, label and math unchanged. Return only the rewritten LaTeX.\n\n{sel}' },
  { id: 'grammar', label: 'Fix grammar', hint: 'Correct spelling and grammar in the selection', needsSel: true, replace: true, prompt: 'Correct only spelling, grammar and punctuation in this LaTeX text. Keep all LaTeX commands unchanged. Return only the corrected LaTeX.\n\n{sel}' },
  { id: 'shorten', label: 'Shorten', hint: 'Make the selection shorter', needsSel: true, replace: true, prompt: 'Make this LaTeX text about 30% shorter without losing meaning. Keep LaTeX commands and citations. Return only the LaTeX.\n\n{sel}' },
  { id: 'explain', label: 'Explain', hint: 'Explain the selected code', needsSel: true, prompt: 'Explain what this LaTeX code does, in plain words:\n\n{sel}' },
  { id: 'table', label: 'Make a table', hint: 'Describe a table', ask: 'Describe the table (columns, rows, data)', prompt: 'Write a LaTeX table (booktabs style, with caption and label) for: {input}' },
  { id: 'equation', label: 'Write an equation', hint: 'Describe an equation in words', ask: 'Describe the equation in words', prompt: 'Write this as a LaTeX equation environment with a label: {input}' },
  { id: 'tikz', label: 'Draw a diagram', hint: 'TikZ diagram from a description', ask: 'Describe the diagram', prompt: 'Write a complete TikZ figure (figure environment, caption, label) for: {input}. List any packages it needs in a comment at the top.' },
  { id: 'abstract', label: 'Draft abstract', hint: 'Draft an abstract from the document', prompt: 'Read this LaTeX document and draft an abstract of about 150 words, in an abstract environment. Do not invent results that are not in the text.\n\n{doc}' },
  { id: 'title', label: 'Suggest titles', hint: 'Title ideas from the document', prompt: 'Suggest five clear titles for this document. Plain list only.\n\n{doc}' },
  { id: 'translate', label: 'Translate', hint: 'Translate the selection', needsSel: true, replace: true, ask: 'Translate to which language?', prompt: 'Translate this LaTeX text to {input}. Keep all LaTeX commands unchanged. Return only the LaTeX.\n\n{sel}' }
];
