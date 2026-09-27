-- Render fenced-div callouts (::: note, tip, warning, case, step, skip)
-- as labelled blocks in every output format.
local labels = {
  ru = { note = "Заметка", tip = "Совет", warning = "Осторожно", case = "Пример", step = "Шаг", skip = "Знаете — пропускайте" },
  en = { note = "Note", tip = "Tip", warning = "Watch out", case = "Case", step = "Your step", skip = "Know this? Skip ahead" },
}
local lang = "ru"

function Meta(m)
  if m.lang then
    local l = pandoc.utils.stringify(m.lang)
    if l:sub(1, 2) == "en" then lang = "en" end
  end
end

function Div(el)
  for _, cls in ipairs(el.classes) do
    local label = labels[lang][cls]
    if label then
      local head = pandoc.Para({ pandoc.Strong({ pandoc.Str(label) }) })
      table.insert(el.content, 1, head)
      if FORMAT:match("html") or FORMAT:match("epub") then
        el.classes:insert("callout")
        return el
      end
      return pandoc.BlockQuote(el.content)
    end
  end
end

return { { Meta = Meta }, { Div = Div } }
