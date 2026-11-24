-- Datex Word export filter for Pandoc.
-- Makes the Word file follow the LaTeX layout: cover image first, title where \maketitle is,
-- contents where \tableofcontents is, chapters on new pages, numbered figures and tables,
-- and working \ref numbers.

local function xml(s) return pandoc.RawBlock('openxml', s) end
local pagebreak = xml('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
local toc = xml([[<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>]] ..
  [[<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r>]] ..
  [[<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Right-click here and choose Update Field to show the contents.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>]])

local function image_in(text)
  return text:match('\\includegraphics%s*%b[]%s*(%b{})') or text:match('\\includegraphics%s*(%b{})')
end

local meta_title, meta_author, meta_date

local function styled(style, inlines)
  return pandoc.Div({ pandoc.Para(inlines) }, { ['custom-style'] = style })
end

local function raw_block(el)
  if el.format ~= 'latex' and el.format ~= 'tex' then return nil end
  local t = el.text
  if t:match('^%s*\\clearpage%s*$') or t:match('^%s*\\newpage%s*$') or t:match('^%s*\\cleardoublepage%s*$') then return { pagebreak } end
  if t:match('\\tableofcontents') then return { toc, pagebreak } end
  if t:match('\\maketitle') then
    local out = {}
    if meta_title then table.insert(out, styled('Title', meta_title)) end
    if meta_author then table.insert(out, styled('Subtitle', meta_author)) end
    if meta_date then table.insert(out, styled('Subtitle', meta_date)) end
    return out
  end
  local img = image_in(t)
  if img and (t:match('tikzpicture') or t:match('titlepage')) then
    local image = pandoc.Image({}, img:sub(2, -2))
    image.attributes.width = '100%'
    return { pandoc.Para({ image }), pagebreak }
  end
  return {}
end

local function inlines_of(m)
  if m == nil then return nil end
  if pandoc.utils.type(m) == 'Inlines' then return m end
  if pandoc.utils.type(m) == 'List' then
    local out = pandoc.Inlines({})
    for i, a in ipairs(m) do
      if i > 1 then out:insert(pandoc.Str(', ')) end
      out:extend(inlines_of(a) or {})
    end
    return out
  end
  return pandoc.Inlines({ pandoc.Str(pandoc.utils.stringify(m)) })
end

function Pandoc(doc)
  meta_title, meta_author, meta_date = inlines_of(doc.meta.title), inlines_of(doc.meta.author), inlines_of(doc.meta.date)
  -- Word should not add its own title block; LaTeX only shows the title where \maketitle is.
  doc.meta.title, doc.meta.author, doc.meta.date = nil, nil, nil

  local numbers = {}
  local h = { 0, 0, 0 }
  local fig, tab = 0, 0
  local chapters = doc.meta['datex-chapters'] ~= nil

  doc = doc:walk({
    RawBlock = raw_block,
    RawInline = function(el)
      if el.format == 'latex' or el.format == 'tex' then
        if el.text:match('^\\newline') or el.text:match('^\\\\') then return pandoc.LineBreak() end
        return {}
      end
    end,
  })

  doc = doc:walk({
    traverse = 'topdown',
    Header = function(el)
      if el.classes:includes('unnumbered') then return nil end
      local l = el.level
      if l <= 3 then
        h[l] = h[l] + 1
        for i = l + 1, 3 do h[i] = 0 end
        if l == 1 and chapters then fig, tab = fig, tab end
        local parts = {}
        for i = 1, l do table.insert(parts, tostring(h[i])) end
        if el.identifier ~= '' then numbers[el.identifier] = table.concat(parts, '.') end
      end
      return nil
    end,
    Figure = function(el)
      fig = fig + 1
      if el.identifier ~= '' then numbers[el.identifier] = tostring(fig) end
      local first = el.caption.long[1]
      if first and first.content then first.content:insert(1, pandoc.Str('Figure ' .. fig .. ': ')) end
      return el
    end,
    Table = function(el)
      tab = tab + 1
      if el.identifier ~= '' then numbers[el.identifier] = tostring(tab) end
      local first = el.caption.long[1]
      if first and first.content then first.content:insert(1, pandoc.Str('Table ' .. tab .. ': ')) end
      return el
    end,
  })

  doc = doc:walk({
    Link = function(el)
      local kind = el.attributes['reference-type']
      local target = el.attributes['reference'] or el.target:gsub('^#', '')
      if kind and numbers[target] then
        el.content = { pandoc.Str(numbers[target]) }
        return el
      end
    end,
  })

  -- Chapters (report and book classes) start on a new page, as in the PDF; never two page breaks in a row.
  local function is_break(b) return b and b.t == 'RawBlock' and b.text:match('w:type="page"') end
  local blocks, seen_text = pandoc.Blocks({}), false
  for _, b in ipairs(doc.blocks) do
    if chapters and b.t == 'Header' and b.level == 1 and seen_text and not is_break(blocks[#blocks]) then blocks:insert(pagebreak) end
    if not (is_break(b) and is_break(blocks[#blocks])) then blocks:insert(b) end
    seen_text = true
  end
  doc.blocks = blocks
  return doc
end
