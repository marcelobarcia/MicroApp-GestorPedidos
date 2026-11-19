(() => {
'use strict'
const fold = (value) => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const number = (value, money = false) => {
  if (typeof value === 'number') return value
  let raw = String(value ?? '').replace(/[$\s]/g, '')
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return 0
  if (raw.includes(',')) raw = raw.replaceAll('.', '').replace(',', '.')
  else if ((money || raw.split('.').length > 2) && /^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replaceAll('.', '')
  return Number(raw) || 0
}
const offer = (name = '', size = 1, net = 0, gross = 0, unit = 'kg', available = true) => ({
  name, size, net: net || (gross ? Math.round(gross / 1.19) : 0), gross: gross || (net ? Math.round(net * 1.19) : 0), unit, available
})
const unavailable = /sin\s*stock|s\s*\/\s*existencia|agotado/i
function tieredOffer(row, alternateGross, minimumUnits = 0) {
  if (alternateGross > 0 && alternateGross < row.gross) {
    row.tier = {gross:alternateGross, net:Math.round(alternateGross / 1.19)}
    if (minimumUnits > 1) row.tier.minQty = minimumUnits
  }
  return row
}
function veguitaTable(items) {
  const text = items.filter(item => item.str?.trim()).map(item => ({
    value:item.str.trim(), x:item.transform[4], y:item.transform[5], center:item.transform[4] + item.width / 2
  }))
  const headers = text.filter(item => /^(prem|x 1)$/.test(fold(item.value))).sort((a,b) => b.y - a.y)
  return headers.flatMap((base, index) => {
    const byQuantity = fold(base.value) === 'x 1'
    const other = text.find(item => fold(item.value) === (byQuantity ? 'x 5' : 'vol') && Math.abs(item.y - base.y) < 5 && item.x > base.x)
    if (!other) return []
    const format = text.find(item => fold(item.value) === 'formato' && Math.abs(item.y - base.y) < 15 && item.x < base.x)
    const split = (base.center + other.center) / 2
    const end = headers[index + 1]?.y ?? -Infinity
    const section = text.filter(item => item.y < base.y - 5 && item.y > end)
    const money = section.filter(item => /^\$\s*[\d.]+$/.test(item.value))
    const nearby = (source, y) => source.filter(item => Math.abs(item.y - y) <= 12)
      .sort((a,b) => Math.abs(a.y-y) - Math.abs(b.y-y))[0]
    return money.filter(item => item.center < split && item.center > base.center - 37).flatMap(item => {
      const spec = format && nearby(section.filter(part =>
        Math.abs(part.center - format.center) < 35 && /^\d+(?:[,.]\d+)?\s*(?:kg|g(?:rs?)?\.?|un(?:idades)?\.?|cjs?\.?|cajas?)$/i.test(part.value)), item.y)
      const name = nearby(section.filter(part => part.x < (format ? format.x - 30 : base.x - 90) && /^\p{L}/u.test(part.value)), item.y)
      if (!name) return []
      const measure = spec?.value.match(/^(\d+(?:[,.]\d+)?)\s*(kg|g(?:rs?)?|un(?:idades)?|cjs?|cajas?)/i)
      const kind = measure?.[2].toLowerCase() === 'kg' ? 'kg' : 'unidad'
      const gramPack = /^g/.test(measure?.[2].toLowerCase() || '')
      const size = measure && !gramPack ? number(measure[1]) : 1
      if (!(size > 0)) return []
      const product = gramPack ? `${name.value} · ${spec.value}` : name.value
      const gross = Math.round(number(item.value, true) * size)
      const alt = nearby(money.filter(part => part.center >= split), item.y)
      return [tieredOffer(offer(product, size, 0, gross, kind, !unavailable.test(name.value)), Math.round(number(alt?.value, true) * size), byQuantity ? 5 : 0)]
    })
  })
}
function veguitaRetailTable(items) {
  const text = items.filter(item => item.str?.trim()).map(item => ({
    value:item.str.trim(), x:item.transform[4], y:item.transform[5],
    center:item.transform[4] + item.width / 2, height:item.height
  }))
  const headers = text.filter(item => /^(1 kg|x 1)$/.test(fold(item.value))).sort((a,b) => b.y - a.y)
  return headers.flatMap((base, index) => {
    const unit = fold(base.value) === '1 kg' ? 'kg' : 'unidad'
    const alternate = text.find(item => /^x 5(?: kg)?$/.test(fold(item.value)) &&
      Math.abs(item.y - base.y) <= 5 && item.x > base.x)
    const nextHeader = headers[index + 1]?.y ?? -Infinity
    const section = text.filter(item => item.y < base.y - 8 && item.y > nextHeader)
    const prices = section.filter(item => /^\$\s*[\d.]+$/.test(item.value))
    const names = section.filter(item => item.x < base.x - 45 && /\p{L}/u.test(item.value) &&
      item.height > base.height && item.height < base.height * 1.65).sort((a,b) => b.y - a.y)
    const priceAt = (name, column) => {
      if (!column) return 0
      const cell = prices.filter(item => Math.abs(item.center - column.center) < 38 && Math.abs(item.y - name.y) <= 10)
        .sort((a,b) => Math.abs(a.y - name.y) - Math.abs(b.y - name.y))[0]
      return number(cell?.value, true)
    }
    return names.map(name => {
      const gross = priceAt(name, base)
      return tieredOffer(offer(name.value, 1, 0, gross, unit, Boolean(gross) && !unavailable.test(name.value)), priceAt(name, alternate), 5)
    })
  })
}
function parseLines(lines, format) {
  const rows = []
  for (const original of lines) {
    const line = original.replace(/\s+/g, ' ').trim()
    if (format === 'terra') {
      const match = line.match(/^\D{0,2}(\d{1,3})\s+(.+?)\s+(\d+(?:[,.]\d+)?)\s+\$?\s*([\d.]+)\s+\$?\s*([\d.]+)\s+(\d{1,3})\s+(\d+(?:[,.]\d+)?)\s+\$?\s*([\d.]+)\s+\$?\s*([\d.]+)/)
      if (!match || match[1] !== match[6]) continue
      const name = match[2].replace(/\s+(SIN STOCK|OFERTA)\b.*/i, '')
      rows.push(offer(name, number(match[3]), 0, number(match[5], true), 'kg', !unavailable.test(line)))
      rows.push(offer(name, number(match[7]), 0, number(match[9], true), 'kg', !unavailable.test(line)))
    } else if (format === 'alana') {
      const match = line.match(/^(.+?)\s+(\d+,\d{2})\s+((?:\$\s*[\d. ]+|#N\/D).*)$/i)
      if (!match) continue
      const prices = [...match[3].matchAll(/\$\s*([\d. ]+)|#N\/D/gi)].map((part) => number(part[1], true))
      if (prices.length < 4) continue
      const name = match[1].replace(/^(?:MANI CRUDO|FRUTOS SECOS|DESHIDRATADOS|CONFITADOS|COBERTURAS|SEMILLAS|MANI)\s+/i, '').replace(/\s+(?:Caja|Saco|Bolsa)\b.*$/i, '')
      rows.push(offer(name, number(match[2]), prices[2], prices[3], 'kg', !unavailable.test(line) && !!prices[2]))
    } else if (format === 'star') {
      const match = line.match(/^\S+\s+\S+\s+(\w{7,})\s+(.+?)\s+Starfood a Granel\s+(\d+(?:[.,]\d+)?)\s+(?:Bolsa(?: Papel)?|Saco(?: Papel)?|Caja)\s+(?:(\d[\d.]*)\s*(\d[\d.]*)?|(s\/existencia))(?:\s+(.*))?$/i)
      if (!match) continue
      const size = number(match[3])
      const row = offer(match[2], size, number(match[5], true) || Math.round(size * number(match[4], true)), 0, 'kg', !match[6])
      row.code = match[1]
      row.origin = match[7] || ''
      rows.push(row)
    } else {
      const match = original.trim().match(/^(.+?)(?:\s{2,}|\s+)\$\s*([\d.]+)\s*$/)
      if (match) rows.push(offer(match[1].trim(), 1, 0, number(match[2], true), 'unidad', !unavailable.test(original)))
    }
  }
  return rows
}
function sheetRows(grid) {
  const nameColumn = /^(?:nombre(?: productos?)?|productos?|descripcion(?: producto)?|articulo|item)$/
  const header = grid.findIndex(row => row.some(cell => nameColumn.test(fold(cell))) && row.some(cell => /precio|neto|total|valor/.test(fold(cell))))
  if (header < 0) return []
  const labels = grid[header].map(fold)
  const column = (regex) => labels.findIndex(label => regex.test(label))
  const name = column(nameColumn)
  const original = labels.indexOf('formato original')
  const originalPrice = labels.indexOf('precio unit original iva incl')
  const originalTotal = labels.indexOf('total formato original')
  if (original >= 0 && originalPrice >= 0 && originalTotal >= 0) {
    const formats = [[original, originalPrice, originalTotal], ['formato menor', 'precio unit menor iva incl', 'total formato menor'].map(label => labels.indexOf(label))]
    const unitColumn = labels.indexOf('unidad')
    const statusColumn = labels.indexOf('estado')
    const notesColumn = labels.indexOf('observacion')
    return grid.slice(header + 1).flatMap(row => {
      const product = String(row[name] ?? '').trim()
      if (!product) return []
      const weightedUnit = /unidad de\s+\d+(?:[.,]\d+)?\s*kg\b/i.test(row[notesColumn] ?? '')
      const unit = weightedUnit || /kg|kilo/.test(fold(row[unitColumn])) ? 'kg' : 'unidad'
      const available = !unavailable.test(row[statusColumn] ?? '')
      return formats.flatMap(([size, perUnit, total]) => {
        const amount = number(row[size])
        if (!amount) return []
        const gross = number(row[total], true) || Math.round(number(row[perUnit], true) * amount)
        return [offer(product, amount, 0, gross, unit, available && gross > 0)]
      })
    })
  }
  const size = column(/^(?:kilos|kg|kilos x saco|peso|contenido|cantidad por envase|unidades por caja|formato)$/)
  const unit = column(/^unidad(?: de medida)?$/)
  const code = column(/^(?:codigo(?: producto)?|sku|ean 13)$/)
  const origin = column(/^origen$/)
  const net = column(/^(?:neto|precio neto|precio sin iva|precio neto caja|total neto|total sin iva)$/)
  const gross = column(/^(?:precio|valor|total|bruto|precio con iva|total con iva|precio bruto)$/)
  const netKg = column(/(?:kilo|kg).*(?:neto|sin iva)|(?:neto|sin iva).*(?:kilo|kg)/)
  const grossKg = column(/(?:kilo|kg).*con iva|con iva.*(?:kilo|kg)/)
  const alternate = column(/^(?:precio alternativo con iva|precio volumen con iva)$/)
  const minimumUnits = column(/^minimo de unidades$/)
  return grid.slice(header + 1).filter(row => String(row[name] ?? '').trim()).map(row => {
    const amount = number(String(row[size] ?? '').match(/\d+(?:[,.]\d+)?/)?.[0]) || 1
    const kind = /kg|kilo/.test(fold(row[unit])) || netKg >= 0 || grossKg >= 0 || /kg|kilo|peso/.test(fold(row[size]) + ' ' + labels[size]) ? 'kg' : 'unidad'
    const item = offer(String(row[name]).trim(), amount, number(row[net], true) || Math.round(number(row[netKg], true) * amount), number(row[gross], true) || Math.round(number(row[grossKg], true) * amount), kind, !unavailable.test(row.join(' ')))
    item.code = String(row[code] ?? '')
    item.origin = String(row[origin] ?? '')
    return tieredOffer(item, number(row[alternate], true), number(row[minimumUnits]))
  })
}
function delimitedRows(text, delimiter) {
  const rows = []
  let row = [], cell = '', quoted = false
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') + '\n'
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (character === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; continue }
    if (character === '"' && (quoted || !cell)) { quoted = !quoted; continue }
    if (!quoted && (character === delimiter || character === '\n')) {
      row.push(cell)
      cell = ''
      if (character === '\n') { rows.push(row); row = [] }
    } else cell += character
  }
  return rows
}
function terraTable(words, width) {
  const rows = []
  for (const word of words.map(w => ({
    text: w.text, x: w.x * 1320 / width, y: w.y * 1320 / width
  })).sort((a, b) => a.y - b.y)) {
    const last = rows.at(-1)
    if (last && word.y - last.y <= 7) last.words.push(word)
    else rows.push({y: word.y, words: [word]})
  }
  const price = value => {
    const digits = value.replace(/^[s$]/i, '').replace(/[oO]/g, '0').replace(/[lIi|]/g, '1').replace(/[_.,\s-]/g, '')
    return /^\d+$/.test(digits) ? Number(digits) : 0
  }
  return rows.flatMap(row => {
    const cells = (min, max) => row.words.filter(w => w.x >= min && w.x < max).sort((a,b) => a.x - b.x).map(w => w.text).join(' ')
    const nameCell = cells(45, 470)
    const code = cells(15, 45) || cells(770, 810)
    const name = nameCell.replace(/\s+(SIN STOCK|OFERTA|NUEVO)\b.*/i, '').trim()
    if (!/^[A-ZÁÉÍÓÚÑ]/i.test(name)) return []
    const sized = (spec, per, total) => {
      const unit = /\bUN\b/i.test(spec) ? 'unidad' : 'kg'
      const size = number(spec.match(/^\d+(?:[,.]\d+)?/)?.[0])
      const byUnit = price(per)
      const gross = price(total)
      // When OCR sees both values, reject readings that disagree substantially.
      if (!size || !gross || !byUnit || Math.abs(gross - size * byUnit) > Math.max(15, size)) return []
      return [{...offer(name, size, 0, gross, unit, !unavailable.test(nameCell)), code: /^\d+$/.test(code) ? code : ''}]
    }
    return [...sized(cells(475, 555), cells(565, 650), cells(655, 765)), ...sized(cells(820, 925), cells(930, 1035), cells(1035, 1155))]
  })
}
function pdfLines(items) {
  const rows = []
  for (const item of items.filter(item => item.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5])) {
    const y = item.transform[5]
    const last = rows.at(-1)
    if (last && Math.abs(last.y - y) <= 2) last.items.push(item)
    else rows.push({y, items: [item]})
  }
  return rows.map(row => row.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(' '))
}
async function script(url, global) {
  if (globalThis[global]) return globalThis[global]
  await new Promise((resolve, reject) => {
    const tag = Object.assign(document.createElement('script'), {src: url, onload: resolve, onerror: reject})
    document.head.append(tag)
  })
  return globalThis[global]
}
function detectCatalog(value) {
  const text = fold(value)
  if (/\bterra verde\b/.test(text)) return 'terra'
  if (/\bstarfood\b/.test(text)) return 'star'
  if (/\balana\b|precio neto caja|lista mayoristas/.test(text)) return 'alana'
  if (/\b(?:emporio la )?veguita\b|emporiolaveguita/.test(text)) return 'veguita'
  return ''
}
function within(operation, stage, ms = 30000) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(stage), {code: 'CATALOG_TIMEOUT'})), ms)
  })
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer))
}
function starfoodProductBrochure(pages, hint) {
  const text = pages.flatMap(page => page.text).join('\n')
  return (detectCatalog(text) || hint) === 'star' &&
    /\bbusca tu producto aqui\b/.test(fold(text)) &&
    (text.match(/\bc[oó]d\s*:/gi)?.length ?? 0) >= 5 &&
    (text.match(/\$\s*\d/g)?.length ?? 0) <= 2 &&
    !/lista de precios|precio lista|sin iva/.test(fold(text))
}
async function readCatalog(file, notify, supplierName = '') {
  const ext = file.name.split('.').at(-1).toLowerCase()
  if (ext === 'csv' || ext === 'tsv') {
    const content = await file.text()
    for (const delimiter of ext === 'tsv' ? ['\t'] : [',', ';', '\t']) {
      const rows = sheetRows(delimitedRows(content, delimiter))
      if (rows.length) return rows
    }
    return []
  }
  if (['xlsx', 'xls', 'ods'].includes(ext)) {
    const xlsx = await within(script('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'XLSX'), 'Cargando el lector de Excel')
    const book = xlsx.read(await file.arrayBuffer())
    return book.SheetNames.flatMap(name => sheetRows(xlsx.utils.sheet_to_json(book.Sheets[name], {header: 1})))
  }
  const lines = []
  const terraRows = []
  const hint = detectCatalog(supplierName) || detectCatalog(file.name)
  let worker
  let closed = false
  const recognize = async (input, blocks = false) => {
    if (!worker) {
      notify('Iniciando reconocimiento de imágenes…')
      const tesseract = await within(script('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js', 'Tesseract'), 'Cargando el lector de imágenes')
      worker = await within(tesseract.createWorker('spa').then(instance => {
        if (closed) void instance.terminate().catch(() => {})
        return instance
      }), 'Iniciando reconocimiento de imágenes', 45000)
    }
    notify('Reconociendo texto de la imagen…')
    const {data} = await within(worker.recognize(input, {}, {blocks}), 'Reconociendo texto de la imagen', 60000)
    return data
  }
  let loadingTask
  try {
    if (ext === 'pdf') {
      const root = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/'
      const engine = await within(import(root + 'pdf.min.mjs'), 'Cargando el lector de PDF')
      engine.GlobalWorkerOptions.workerSrc = root + 'pdf.worker.min.mjs'
      loadingTask = engine.getDocument({data: await file.arrayBuffer()})
      const pdf = await within(loadingTask.promise, 'Abriendo el PDF')
      const pages = []
      for (let i = 1; i <= pdf.numPages; i++) {
        notify(`Leyendo página ${i} de ${pdf.numPages}…`)
        const page = await within(pdf.getPage(i), `Abriendo página ${i}`)
        const {items} = await within(page.getTextContent(), `Leyendo página ${i}`)
        const text = pdfLines(items)
        pages.push({page, text, items})
      }
      const combinedText = pages.flatMap(page => page.text).join(' ')
      if (hint === 'veguita' || detectCatalog(combinedText) === 'veguita') {
        if (pages[0]?.items.some(item => fold(item.str) === 'minorista')) {
          const retail = pages.flatMap(({items}) => veguitaRetailTable(items))
          if (retail.length) return retail
          throw new Error('No se reconocieron las columnas de precios del catálogo minorista de La Veguita.')
        }
        const offers = pages.flatMap(({items}) => veguitaTable(items))
        if (offers.length) {
          offers.volumeMinimum = number(combinedText.match(/\bsobre\s*\$\s*([\d.]+)/i)?.[1]?.replace(/\.$/, ''), true)
          return offers
        }
      }
      if (starfoodProductBrochure(pages, hint)) {
        throw Object.assign(new Error('El folleto de Starfood no contiene una lista de precios.'), {code: 'STARFOOD_BROCHURE'})
      }
      for (const [i, {page, text}] of pages.entries()) {
        const terra = (detectCatalog(text.join(' ')) || hint) === 'terra'
        if (!terra && (text.filter(line => /\d/.test(line)).length >= 4 || (hint === 'star' && text.join(' ').trim()))) {
          lines.push(...text)
          continue
        }
        const natural = page.getViewport({scale: 1})
        const viewport = page.getViewport({scale: Math.min(3, 2000 / natural.width, 3800 / natural.height)})
        const canvas = Object.assign(document.createElement('canvas'), {width: viewport.width, height: viewport.height})
        notify(`Preparando imagen de la página ${i + 1} de ${pages.length}…`)
        await within(page.render({canvasContext: canvas.getContext('2d'), viewport}).promise, `Preparando imagen de la página ${i + 1}`)
        const data = await recognize(canvas, terra)
        lines.push(...data.text.split('\n'))
        if (terra) {
          const words = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)))
          terraRows.push(...terraTable(words.map(w => ({text: w.text, x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2})), canvas.width))
        }
        canvas.width = canvas.height = 0
      }
    } else {
      notify('Reconociendo texto en la imagen…')
      lines.push(...(await recognize(file)).text.split('\n'))
    }
    if (terraRows.length) return terraRows
    const detected = detectCatalog(lines.join(' ')) || hint || 'generic'
    return parseLines(lines, detected)
  } finally {
    closed = true
    if (worker) void worker.terminate().catch(() => {})
    if (loadingTask) void loadingTask.destroy().catch(() => {})
  }
}
globalThis.orderCatalog = {fold, number, offer, readCatalog}
})()
