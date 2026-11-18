;(() => {
'use strict'
const {fold, number, offer, readCatalog} = globalThis.orderCatalog
const cloud = globalThis.orderCloud

const $ = (selector, root = document) => root.querySelector(selector)
const app = $('#app')
const key = 'gestor-pedidos-v1'
const defaults = () => ({vendors: [], catalogs: [], aliases: {}, drafts: [{id: 'first', name: 'Pedido nuevo', lines: []}], active: 'first'})
function localData() {
  try { return JSON.parse(localStorage.getItem(key)) || defaults() } catch { return defaults() }
}
let state = cloud?.profile() ? cloud.workspace()?.snapshot ?? defaults() : localData()
let view = cloud?.invited?.() ? 'account' : 'buy'
let query = ''
const excludedVendors = new Set()
let review = null
let editingLine = null
let editingAlias = null
let responseEditor = null
let busy = false
let noticeTimer
const money = new Intl.NumberFormat('es-CL', {style: 'currency', currency: 'CLP', maximumFractionDigits: 0})
const decimal = new Intl.NumberFormat('es-CL', {maximumFractionDigits: 4})
const orderDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'})
const percentage = new Intl.NumberFormat('es-CL', {style: 'percent', maximumFractionDigits: 2, signDisplay: 'exceptZero'})
const clp = value => money.format(value)
const fmt = value => decimal.format(value)
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]))
const draft = () => state.drafts.find(d => d.id === state.active)
const vendor = id => state.vendors.find(v => v.id === id)
function assignOrderNumber(order) {
  state.orderSequence = (state.orderSequence || 0) + 1
  const date = orderDate.format(new Date()).split('-').reverse().join('-')
  order.numberBase = `${date}-${String(state.orderSequence).padStart(4, '0')}`
}
const orderSuppliers = order => [...new Set(order.lines.map(line => vendor(line.vendorId)?.name).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es'))
const orderNumber = order => {
  const base = order.numberBase.replace(/^(\d{4})(\d{2})(\d{2})-/, '$3-$2-$1-')
  return order.numberOverride || [base, ...orderSuppliers(order).map(name => fold(name).toUpperCase().replaceAll(' ', '-')).filter(Boolean)].join('-')
}
const product = row => state.aliases[row.signature] || row.name
const productKey = row => JSON.stringify([fold(product(row)), row.unit, state.aliases[row.signature] ? '' : fold(row.origin)])
const signature = (row, vendorId) => JSON.stringify([vendorId, fold(row.code || row.name), fold(row.origin)])

function notify(message, persistent = false) {
  clearTimeout(noticeTimer)
  $('#status').textContent = message
  if (!persistent) noticeTimer = setTimeout(() => { $('#status').textContent = '' }, 5000)
}
function save() {
  try {
    if (!cloud?.local(state)) localStorage.setItem(key, JSON.stringify(state))
    return true
  }
  catch { notify('El navegador no pudo guardar los cambios. Mantén esta pestaña abierta.', true); return false }
}
const intro = (title, subtitle) => `<div class="intro"><h1>${title}</h1><p class="muted">${subtitle}</p></div>`
const options = (values, current) => values.map(([value,label]) => `<option value="${h(value)}" ${value === current ? 'selected' : ''}>${h(label)}</option>`).join('')
const providers = () => options([['','Selecciona un proveedor'], ...state.vendors.map(v => [v.id,v.name])], review?.vendorId)
const allOffers = () => state.catalogs.flatMap(c => c.rows.map(row => ({...row, vendorId: c.vendorId, date: c.date})))
const canOrder = row => row.available && row.net > 0 && row.size > 0
const samePresentation = (a, b) => a.size === b.size && a.unit === b.unit && (
  (a.signature && a.signature === b.signature) || ((!a.code || !b.code) && fold(a.name) === fold(b.name) && fold(a.origin) === fold(b.origin))
)
function priceChange(row) {
  if (!row.previousNet) return ''
  const delta = (row.net - row.previousNet) / row.previousNet
  const label = delta > 0 ? 'Subió' : delta < 0 ? 'Bajó' : 'Sin cambio'
  const tone = delta > 0 ? 'price-up' : delta < 0 ? 'price-down' : ''
  return `<br><small class="${tone}"><strong>${label} ${percentage.format(delta)}</strong> · antes ${clp(row.previousNet / row.size)} / ${row.unit} neto</small>`
}
const alternatives = line => [line, ...allOffers().filter(row => row.id !== line.id && canOrder(row) && productKey(row) === productKey(line))
  .sort((a, b) => a.net / a.size - b.net / b.size)]
const totals = lines => lines.reduce((sum, line) => ({net: sum.net + line.net * line.qty, gross: sum.gross + line.gross * line.qty}), {net: 0, gross: 0})
const totalsHtml = ({net,gross}) => `<div class="totals"><span>Neto</span><span>${clp(net)}</span><span>IVA</span><span>${clp(gross - net)}</span><strong>Total con IVA</strong><strong>${clp(gross)}</strong></div>`

function renderResults(refreshFilters = true) {
  const target = $('#results')
  if (!target) return
  const filterTarget = $('#vendor-filters')
  const terms = fold(query).split(' ').filter(Boolean)
  if (!terms.length && state.catalogs.length) {
    if (filterTarget) filterTarget.innerHTML = ''
    target.innerHTML = '<div class="card empty">Escribe un producto para ver sus precios y presentaciones.</div>'
    return
  }
  const groups = new Map()
  for (const row of allOffers()) {
    const name = product(row)
    const haystack = fold([name, row.name, row.code, row.origin, vendor(row.vendorId)?.name].join(' '))
    const groupKey = productKey(row)
    if (!groups.has(groupKey)) groups.set(groupKey, {name, rows: [], matches: false})
    const group = groups.get(groupKey)
    group.rows.push(row)
    group.matches ||= terms.every(part => haystack.includes(part))
  }
  const matches = [...groups.values()].filter(group => group.matches).sort((a,b) => a.name.localeCompare(b.name, 'es'))
  const matchingIds = new Set(matches.flatMap(group => group.rows.map(row => row.vendorId)))
  const matchingVendors = state.vendors.filter(v => matchingIds.has(v.id)).sort((a,b) => a.name.localeCompare(b.name, 'es'))
  const filters = matchingVendors.length ? `<fieldset class="card vendor-filters"><legend>Filtrar por proveedor</legend><div class="actions">
    ${matchingVendors.map(v => `<label class="check"><input type="checkbox" data-filter-vendor="${h(v.id)}" ${excludedVendors.has(v.id) ? '' : 'checked'}> ${h(v.name)}</label>`).join('')}
    </div></fieldset>` : ''
  const visible = matches.map(group => ({...group, rows: group.rows.filter(row => !excludedVendors.has(row.vendorId))})).filter(group => group.rows.length)
  if (filterTarget && refreshFilters) filterTarget.innerHTML = filters
  target.innerHTML = visible.length ? visible.map(({name, rows}) => {
    const valid = canOrder
    rows.sort((a,b) => Number(valid(b)) - Number(valid(a)) || a.net / a.size - b.net / b.size)
    const best = valid(rows[0]) ? rows[0] : null
    const suppliers = new Map()
    const smallest = new Map()
    const bySize = new Map()
    for (const row of rows) {
      if (!suppliers.has(row.vendorId)) suppliers.set(row.vendorId, [])
      suppliers.get(row.vendorId).push(row)
      if (valid(row)) {
        const baseline = smallest.get(row.vendorId)
        if (!baseline || row.size < baseline.size) smallest.set(row.vendorId, row)
        if (!bySize.has(row.size)) bySize.set(row.size, new Map())
        const peers = bySize.get(row.size)
        if (!peers.has(row.vendorId)) peers.set(row.vendorId, row)
      }
    }
    function sizeSavings(row) {
      const baseline = smallest.get(row.vendorId)
      if (!baseline || row.size <= baseline.size) return ''
      const savings = 1 - (row.net / row.size) / (baseline.net / baseline.size)
      if (savings < 0.00005) return ''
      return `<br><small class="price-down"><strong>${percentage.format(savings).replace(/^\+/, '')} menos por ${row.unit}</strong> frente a ${fmt(baseline.size)} ${row.unit}</small>`
    }
    function sameSizeDifference(row) {
      const peers = bySize.get(row.size)
      if (!peers || peers.size < 2) return ''
      const other = [...peers.values()].find(candidate => candidate.vendorId !== row.vendorId)
      const difference = (row.net - other.net) / other.net
      if (Math.abs(difference) < 0.00005) return ''
      const comparison = difference < 0 ? 'menos' : 'más'
      return `<br><small class="${difference < 0 ? 'price-down' : 'price-up'}"><strong>${percentage.format(Math.abs(difference)).replace(/^\+/, '')} ${comparison}</strong> que ${h(vendor(other.vendorId)?.name)} en ${fmt(row.size)} ${row.unit}</small>`
    }
    const comparableSizes = [...bySize].filter(([, peers]) => peers.size > 1).sort(([a], [b]) => a - b)
    return `<article class="card comparison"><h3>${h(name)}</h3>
      ${best ? `<div class="comparison-best"><div><span class="best-label">Menor precio neto</span><small>${h(vendor(best.vendorId)?.name)} · ${fmt(best.size)} ${best.unit}</small></div><div class="best-prices"><strong>${clp(best.net / best.size)} <span>/ ${best.unit} neto</span></strong><small>${clp(best.gross / best.size)} / ${best.unit} con IVA</small></div></div>` : ''}
      ${comparableSizes.length ? `<div class="size-comparison"><h4>Menor precio por presentación</h4><dl>
      ${comparableSizes.map(([size, peers]) => {
        const offers = [...peers.values()]
        const winner = offers[0]
        const winners = offers.filter(row => row.net === winner.net).map(row => vendor(row.vendorId)?.name).join(' y ')
        return `<div><dt>${fmt(size)} ${winner.unit}</dt><dd>${h(winners)} · <strong>${clp(winner.net / size)} / ${winner.unit} neto</strong> · <small>${clp(winner.gross / size)} / ${winner.unit} con IVA</small></dd></div>`
      }).join('')}</dl></div>` : ''}
      ${[...suppliers].map(([vendorId, offers]) => `<section class="supplier-offers"><h4>${h(vendor(vendorId)?.name)}</h4>
      ${offers.sort((a,b) => b.size - a.size).map(r => `<div class="offer comparison-offer${r === best ? ' best-offer' : ''}">
      <div class="offer-format"><strong>${fmt(r.size)} ${r.unit}</strong>
      <small>${h(r.name)}${r.origin ? ' · ' + h(r.origin) : ''}</small>
      <button type="button" class="offer-alias" data-alias="${h(r.id)}" aria-expanded="${editingAlias === r.id}">Equivalencia</button></div>
      <div class="offer-price">${valid(r) ? `<strong>${clp(r.net / r.size)} / ${r.unit} neto</strong><br>
      <small>${clp(r.gross / r.size)} / ${r.unit} con IVA</small><br>
      <small>Por unidad de compra · ${clp(r.net)} neto · ${clp(r.gross)} con IVA</small>${sameSizeDifference(r)}${sizeSavings(r)}${priceChange(r)}` : '<small>Sin precio o disponibilidad</small>'}</div>
      ${valid(r) ? `<button class="primary" data-add="${h(r.id)}">Agregar</button>` : ''}
      ${editingAlias === r.id ? `<form class="stack line-editor" data-alias-form="${h(r.id)}">
        <label>Nombre común<input id="alias-name" name="alias" maxlength="160" required value="${h(product(r))}"></label>
        <small>Usa el mismo nombre en cada oferta que quieras comparar como un solo producto.</small>
        <div class="actions"><button class="primary">Guardar equivalencia</button><button type="button" id="cancel-alias">Cancelar</button>
        ${state.aliases[r.signature] ? '<button type="button" id="clear-alias">Quitar equivalencia</button>' : ''}</div>
      </form>` : ''}
      </div>`).join('')}</section>`).join('')}</article>`
  }).join('') : matches.length
    ? '<div class="card empty">Marca al menos un proveedor para mostrar sus ofertas.</div>'
    : state.catalogs.length
    ? `<div class="card"><p>No encontramos productos para «${h(query)}» en tus catálogos activos.</p><button data-view="import">Ver catálogos</button></div>`
    : '<div class="card"><p>Aún no tienes un catálogo activo. Puedes cargar uno o probar con la almendra de Terra Verde.</p><div class="actions"><button class="primary" data-view="import">Cargar catálogo</button><button id="sample">Probar con almendra</button></div></div>'
}
function orderMessage(v, lines, withSymbols = false) {
  const {net,gross} = totals(lines)
  const greeting = v.contactName?.trim() || `equipo de ${v.name}`
  const bold = text => withSymbols ? text : `*${text}*`
  const italic = text => withSymbols ? text : `_${text}_`
  return [
    `Hola, ${greeting}${withSymbols ? ' \u270B\uFE0F' : '.'}`,
    '', withSymbols ? '\u2705 Detalle del pedido' : bold('Detalle del pedido'),
    `${bold('Proveedor:')} ${v.name}`, '',
    lines.map((l, index) => {
      const quantity = `${l.qty} ${l.qty === 1 ? 'unidad' : 'unidades'} de ${fmt(l.size)} ${l.unit}`
      return `${index + 1}. ${bold(l.name)}${l.code ? ' (' + l.code + ')' : ''}\n${italic(quantity)} | ${clp(l.net)} neto por unidad\nSubtotal neto: ${clp(l.net * l.qty)}`
    }).join('\n\n'),
    '', withSymbols ? '\u2696\uFE0F Totales en CLP' : bold('Totales en CLP'), `Neto: ${clp(net)}`, `IVA: ${clp(gross-net)}`, bold(`Total con IVA: ${clp(gross)}`),
    '', 'Por favor, confirmen disponibilidad, precios y fecha estimada de entrega. ¡Gracias!'
  ].join('\n')
}
function whatsapp(v, lines) {
  const digits = v?.phone?.replace(/\D/g, '') || ''
  if (!/^[1-9]\d{7,14}$/.test(digits)) return ''
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(orderMessage(v, lines))
}
function emailOrder(v, lines) {
  if (!v?.email) return ''
  const contact = encodeURIComponent(v.email).replace('%40', '@')
  const subject = encodeURIComponent(`\u2705 Solicitud de pedido | ${v.name}`)
  const body = encodeURIComponent(orderMessage(v, lines, true).replaceAll('\n', '\r\n'))
  return `mailto:${contact}?subject=${subject}&body=${body}`
}
const channels = {whatsapp: 'WhatsApp', email: 'correo'}
const orderLines = (order, vendorId) => order.lines.filter(line => line.vendorId === vendorId)
const orderVersion = lines => JSON.stringify(lines.map(({id, qty, net, gross}) => [id, qty, net, gross]))
function deliveryState(order, vendorId) {
  const version = orderVersion(orderLines(order, vendorId))
  const delivery = order.deliveries?.[vendorId] ?? {}
  return Object.entries(delivery).filter(([, record]) => record.version === version)
}
function currentAgreement(order, vendorId) {
  const agreement = order.agreements?.[vendorId]
  return agreement?.version === orderVersion(orderLines(order, vendorId)) ? agreement : null
}
const sentToVendor = (order, vendorId) => deliveryState(order, vendorId).some(([, record]) => record.sent)
function orderStatus(order) {
  const vendors = [...new Set(order.lines.map(line => line.vendorId))]
  const deliveries = vendors.map(vendorId => deliveryState(order, vendorId))
  const agreements = vendors.map(vendorId => currentAgreement(order, vendorId)).filter(Boolean)
  if (agreements.length && agreements.length === vendors.length) return agreements.some(a => a.changed) ? 'Confirmado con cambios' : 'Confirmado'
  const sent = vendors.filter(vendorId => currentAgreement(order, vendorId) || sentToVendor(order, vendorId)).length
  if (agreements.length) return `Confirmación parcial · ${agreements.length} de ${vendors.length} proveedores`
  if (sent && sent === vendors.length) return 'Enviado'
  if (sent) return `Envío parcial · ${sent} de ${vendors.length} proveedores`
  if (deliveries.some(entries => entries.length)) return 'Pendiente de confirmar envío'
  return order.saved ? 'Guardado · pendiente de envío' : 'Borrador'
}
function deliveryHtml(order, vendorId) {
  const agreement = currentAgreement(order, vendorId)
  const status = agreement ? `<span class="tag">${agreement.changed ? 'Confirmado con cambios' : 'Confirmado'}</span>` : ''
  const response = agreement || sentToVendor(order, vendorId)
    ? `<button data-vendor-response>Registrar respuesta del proveedor</button>` : ''
  return deliveryState(order, vendorId).map(([channel, record]) => record.sent
    ? `<span class="tag">Enviado por ${channels[channel]}</span>`
    : `<button data-confirm-send="${channel}">Confirmar envío por ${channels[channel]}</button>`).join('') + status + response
}
function responseForm(lines) {
  return `<form class="stack line-editor" id="vendor-response">
    <h4>Respuesta del proveedor</h4>
    <p>Completa solo los precios que cambiaron. Al confirmar, se actualizará el pedido y el precio vigente para futuras compras.</p>
    ${lines.map(line => `<fieldset class="response-line"><legend>${h(line.name)} · ${fmt(line.size)} ${h(line.unit)}</legend>
      <small>Precio actual del pedido ${clp(line.net)} neto por unidad de compra</small>
      <div class="fields"><label>Nuevo precio en CLP<input name="price-${h(line.id)}" type="number" min="0.01" max="999999999" step="0.01" inputmode="decimal" placeholder="${h(line.net)}"></label>
      <label>Precio indicado por el proveedor<select name="basis-${h(line.id)}">
        <option value="net">Neto por unidad de compra</option><option value="gross">Con IVA por unidad de compra</option>
        ${line.size !== 1 ? `<option value="netMeasure">Neto por ${h(line.unit)}</option><option value="grossMeasure">Con IVA por ${h(line.unit)}</option>` : ''}
      </select></label></div></fieldset>`).join('')}
    <div class="actions"><button class="primary">Confirmar precio acordado</button><button type="button" id="cancel-response">Cancelar</button></div>
  </form>`
}
function acknowledgePrices(editor, data) {
  const order = draft()
  const vendorId = editor.vendorId
  const lines = orderLines(order, vendorId)
  if (order.id !== editor.orderId || orderVersion(lines) !== editor.version ||
      !(currentAgreement(order, vendorId) || sentToVendor(order, vendorId))) {
    notify('El pedido cambió. Vuelve a abrir la respuesta del proveedor.')
    return
  }
  const original = order.agreements?.[vendorId]?.original ?? lines.map(({id, qty, net, gross}) => ({id, qty, net, gross}))
  const prices = new Map()
  for (const line of lines) {
    const value = data.get(`price-${line.id}`)
    if (!value) continue
    const basis = data.get(`basis-${line.id}`) || 'net'
    const amount = Math.round(Number(value) * (basis.endsWith('Measure') ? line.size : 1))
    const grossQuoted = basis.startsWith('gross')
    const net = grossQuoted ? Math.round(amount / 1.19) : amount
    const gross = grossQuoted ? amount : Math.round(net * 1.19)
    if (!Number.isSafeInteger(net) || net <= 0 || !Number.isSafeInteger(gross)) { notify('Ingresa un precio válido.'); return }
    if (net !== line.net || gross !== line.gross) prices.set(line.id, {net, gross})
  }
  const catalogs = state.catalogs.slice()
  const rows = catalogs.filter(catalog => catalog.vendorId === vendorId).flatMap(catalog => catalog.rows)
  const updates = new Map()
  const additions = []
  const quoted = lines.filter(line => prices.has(line.id))
  const revisedPresentations = []
  for (const line of quoted) {
    const price = prices.get(line.id)
    const group = revisedPresentations.find(item => samePresentation(item.line, line))
    if (group) {
      if (group.price.net !== price.net || group.price.gross !== price.gross) {
        notify(`Ingresa el mismo precio para las líneas de ${line.name} con la misma presentación.`)
        return
      }
    } else revisedPresentations.push({line, price})
  }
  for (const {line, price} of revisedPresentations) {
    const matches = rows.filter(row => samePresentation(row, line))
    if (matches.length > 1) { notify(`Hay más de una oferta vigente para ${line.name}. Revisa el catálogo del proveedor.`, true); return }
    const match = matches[0]
    const current = match || line
    const updated = {...current, ...price, id: id(), available: true, previousNet: price.net === current.net ? current.previousNet : current.net}
    if (match) {
      if (price.net !== current.net || price.gross !== current.gross || !current.available) updates.set(current.id, updated)
    } else {
      const {qty, vendorId, date, ...offerRow} = updated
      additions.push(offerRow)
    }
    for (const purchase of lines.filter(row => samePresentation(row, line))) prices.set(purchase.id, price)
  }
  const nextLines = order.lines.map(line => prices.has(line.id) && line.vendorId === vendorId ? {...line, ...prices.get(line.id)} : line)
  const revised = nextLines.filter(line => line.vendorId === vendorId)
  const changed = revised.some(line => original.some(before => before.id === line.id && (before.net !== line.net || before.gross !== line.gross)))
  const agreement = {original, changed, version: orderVersion(revised)}
  const next = {...order, lines: nextLines, agreements: {...order.agreements, [vendorId]: agreement}}
  const previousState = state
  state = {
    ...state,
    drafts: state.drafts.map(entry => entry === order ? next : entry),
    catalogs: catalogs.map(catalog => catalog.vendorId === vendorId && catalog.rows.some(row => updates.has(row.id))
      ? {...catalog, rows: catalog.rows.map(row => updates.get(row.id) || row)} : catalog)
  }
  if (additions.length) state.catalogs.push({vendorId, file:'Precios confirmados por el proveedor', date:new Date().toLocaleDateString('es-CL'), rows:additions})
  if (!save()) { state = previousState; return }
  responseEditor = null
  render()
  notify(prices.size ? 'Respuesta guardada y precios vigentes actualizados.' : 'Respuesta guardada.')
}
function freshOrder() {
  const next = {id: id(), name: 'Pedido nuevo', lines: []}
  assignOrderNumber(next)
  state.drafts = state.drafts.filter(order => order.saved || order.lines.length || order.name !== 'Pedido nuevo')
  state.drafts.push(next)
  state.active = next.id
}
function renderCart() {
  const target = $('#cart')
  if (!target) return
  const d = draft()
  const groups = new Map()
  for (const line of d.lines) {
    if (!groups.has(line.vendorId)) groups.set(line.vendorId, [])
    groups.get(line.vendorId).push(line)
  }
  const total = totals(d.lines)
  const shortcut = $('#order-shortcut')
  if (shortcut) shortcut.textContent = d.lines.length ? `Ver pedido · ${clp(total.gross)}` : 'Ver pedido'
  target.innerHTML = `<div class="cart-heading"><h2>Mi pedido</h2><span class="cart-count">${d.lines.length} ${d.lines.length === 1 ? 'línea' : 'líneas'}</span></div>
  <label>Número de pedido<input id="order-number" value="${h(orderNumber(d))}" maxlength="240"></label>
  ${d.lines.length ? [...groups].map(([vendorId, lines]) => {
    const v = vendor(vendorId)
    const url = whatsapp(v, lines)
    const mail = emailOrder(v, lines)
    const agreement = currentAgreement(d, vendorId)
    return `<section class="card" data-order-vendor="${h(vendorId)}"><h3>${h(v?.name || 'Proveedor')}</h3>${lines.map(l => {
      const sent = agreement?.original.find(row => row.id === l.id)
      const adjusted = sent && (sent.net !== l.net || sent.gross !== l.gross)
      return `<div class="item"><div><strong>${h(l.name)}</strong><br><small>${fmt(l.size)} ${l.unit} por unidad de compra · ${clp(l.net)} neto<br>${clp(l.net / l.size)} / ${l.unit} neto</small>
      ${adjusted ? `<br><small class="agreed-price">Enviado ${clp(sent.net)} neto · Acordado ${clp(l.net)} neto</small>` : ''}</div>
      <label>Unidades<input class="qty" type="number" min="1" max="99999" step="1" value="${l.qty}" data-qty="${h(l.id)}"></label><div class="actions"><button data-edit-line="${h(l.id)}">Editar</button><button class="danger" data-remove="${h(l.id)}">Quitar</button></div>
      ${editingLine === l.id ? `<form class="stack line-editor" data-line-editor="${h(l.id)}">
        <label>Proveedor y presentación<select name="offer">${options(alternatives(l).map(r => [r.id, `${vendor(r.vendorId)?.name} · ${fmt(r.size)} ${r.unit} · ${clp(r.net)} neto`]), l.id)}</select></label>
        <label>Cantidad de unidades<input name="qty" type="number" min="1" max="99999" step="1" value="${l.qty}" required></label>
        <div class="actions"><button class="primary">Guardar cambios</button><button type="button" id="cancel-edit">Cancelar</button></div>
      </form>` : ''}</div>`
    }).join('')}
      <div data-subtotal>${totalsHtml(totals(lines))}</div>
      <div class="actions">
      ${url ? `<a class="button primary" data-whatsapp href="${h(url)}" target="_blank" rel="noopener noreferrer">Abrir en WhatsApp ↗</a>` : '<button data-view="vendors">Configurar WhatsApp</button>'}
      ${mail ? `<a class="button" data-order-email href="${h(mail)}">Preparar correo</a>` : '<button data-view="vendors">Configurar correo</button>'}
      </div><div class="actions delivery" data-delivery>${deliveryHtml(d, vendorId)}</div>
      ${responseEditor?.orderId === d.id && responseEditor.vendorId === vendorId ? responseForm(lines) : ''}</section>`
  }).join('') + `<section class="cart-total"><h3>Total del pedido</h3><div id="order-total">${totalsHtml(total)}</div></section>` : '<p class="empty">Agrega una presentación para empezar.</p>'}
  ${d.lines.length ? '<div class="actions"><button class="primary" id="save-order">Guardar pedido</button><button data-view="drafts">Ver guardados</button></div>' : ''}
  <small>Los pedidos se guardan en este navegador.</small>`
}
function renderAccount() {
  const profile = cloud?.profile()
  if (cloud?.invited?.()) {
    app.innerHTML = intro('Activa tu cuenta', 'Elige una contraseña para acceder a Gestor de Pedidos.') + `<section class="card account-card">
      <form id="accept-invite" class="stack"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div><button class="primary">Activar cuenta</button></div></form></section>`
    return
  }
  app.innerHTML = intro('Cuenta', 'Sincroniza catálogos y pedidos entre tus dispositivos.') + `<section class="card stack account-card">
    ${profile ? `<div class="account-profile"><strong>${h(profile.email)}</strong><small>Administrador de este espacio</small></div>
    <form id="business-form" class="fields"><label>Nombre del negocio<input name="businessName" maxlength="80" value="${h(state.businessName)}" placeholder="Ej. Granero Fino" required></label><button class="primary">Guardar nombre</button></form>
    <p id="cloud-status" role="status">${h(cloud.status() || 'Copia disponible en este equipo.')}</p>
    <div class="actions"><button id="sync-now">Sincronizar</button><button id="log-out">Cerrar sesión</button><button id="use-cloud" ${cloud.conflict() ? '' : 'hidden'}>Abrir copia en línea</button></div>` :
    cloud?.configured ? `<form id="account-login" class="stack"><label>Correo<input name="email" autocomplete="email" type="email" required></label>
    <label>Contraseña<input name="password" autocomplete="current-password" type="password" minlength="8" required></label>
    <div class="actions"><button class="primary">Iniciar sesión</button><button name="mode" value="signup">Crear cuenta</button></div></form>` :
    '<p>La sincronización todavía no está configurada. Tus datos se guardan en este navegador.</p>'}
    </section><section class="card stack account-card"><h2>Respaldo de datos</h2><p>Descarga una copia para mover tus catálogos y pedidos a otro dispositivo o a tu cuenta.</p>
    <div class="actions"><button id="backup-workspace">Descargar respaldo</button><label>Importar respaldo<input type="file" id="restore-workspace" accept=".json,application/json"></label></div></section>`
}
function renderGuide() {
  app.innerHTML = intro('Guía de uso', 'De la lista de precios al pedido.') + `<ol class="guide-grid">
    <li class="card"><span class="guide-number" aria-hidden="true">01</span><h2>Conecta tus equipos</h2><p>Entra con el mismo correo en el celular y el computador. En <strong>Cuenta</strong>, guarda el nombre de tu negocio y pulsa <strong>Sincronizar</strong> si quieres verificar que los cambios llegaron.</p><button data-view="account">Ir a Cuenta</button></li>
    <li class="card"><span class="guide-number" aria-hidden="true">02</span><h2>Agrega un proveedor</h2><p>Guarda su nombre, contacto y, si vas a enviarle pedidos desde la app, su WhatsApp o correo.</p><button data-view="vendors">Ir a Proveedores</button></li>
    <li class="card"><span class="guide-number" aria-hidden="true">03</span><h2>Carga sus precios</h2><p>Elige el proveedor y carga su lista en PDF, Excel o CSV. Si es una lista completa, deja marcada la opción de reemplazar las ofertas vigentes.</p><button data-view="import">Ir a Catálogos</button></li>
    <li class="card"><span class="guide-number" aria-hidden="true">04</span><h2>Compara y arma el pedido</h2><p>Busca un producto. Compara el precio por kilo o unidad y el total con IVA. Si dos proveedores usan nombres distintos para el mismo producto, asigna el mismo nombre en <strong>Equivalencia</strong>.</p><button data-view="buy">Ir a Comparar</button></li>
    <li class="card"><span class="guide-number" aria-hidden="true">05</span><h2>Guarda y envía</h2><p>Ajusta las cantidades y guarda el pedido. Ábrelo desde <strong>Pedidos</strong> para preparar WhatsApp o correo. Después de enviarlo, vuelve y confirma el envío.</p><button data-view="drafts">Ir a Pedidos</button></li>
    </ol><section class="card guide-install"><h2>Instala la app</h2>
    <dl>
      <div><dt>iPhone o iPad</dt><dd>Abre la página en Safari. Pulsa <strong>Compartir → Agregar a pantalla de inicio</strong>. Si aparece <strong>Abrir como app web</strong>, déjalo activado y pulsa <strong>Agregar</strong>.</dd></div>
      <div><dt>Android</dt><dd>En Chrome, abre el menú <strong>⋮</strong> y elige <strong>Instalar aplicación</strong> o <strong>Agregar a pantalla principal</strong>.</dd></div>
      <div><dt>Computador</dt><dd>En Chrome o Edge, busca el icono de instalación en la barra de direcciones o la opción <strong>Instalar</strong> en el menú.</dd></div>
    </dl></section>
    <aside class="card guide-offline"><h2>Si se corta internet</h2><p>Puedes usar los precios descargados y guardar pedidos en este equipo. Al recuperar la conexión, verifica el estado en <strong>Cuenta</strong>.</p></aside>`
}
function render() {
  const businessLabel = $('#business-label')
  if (businessLabel) {
    const name = cloud?.profile() ? state.businessName : ''
    businessLabel.textContent = name || ''
    businessLabel.hidden = !name
  }
  document.querySelectorAll('nav [data-view]').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
  if (view === 'buy') {
    const activeSuppliers = new Set(state.catalogs.filter(catalog => catalog.rows.some(canOrder)).map(catalog => catalog.vendorId))
    app.innerHTML = `<section class="price-hero">
      <div><h1>Compara <span>precios</span></h1><p>Encuentra la mejor oferta por kilo o unidad de medida.</p></div>
      <div class="hero-stat"><strong>${activeSuppliers.size}</strong><span>${activeSuppliers.size === 1 ? 'proveedor con precios' : 'proveedores con precios'}</span></div>
    </section>
    <div class="grid"><section><div class="card search-card">
      <label for="search">Buscar producto</label><div class="search-box"><span aria-hidden="true"></span><input id="search" type="search" placeholder="Ej. almendra, avena, cacao…" value="${h(query)}"></div>
      <a id="order-shortcut" class="button order-shortcut" href="#cart">Ver pedido</a>
    </div><div id="vendor-filters"></div><div id="results"></div></section><aside id="cart" class="card cart" aria-label="Mi pedido"></aside></div>`
    renderResults()
    renderCart()
  }
  if (view === 'vendors') {
    app.innerHTML = intro('Proveedores', 'Guarda el WhatsApp y el correo donde enviarás los pedidos.') +
      `<div class="stack">${[...state.vendors, {id:'',name:'',phone:''}].map(v => `<form class="card fields vendor-form" data-vendor="${h(v.id)}"><label>Proveedor<input name="name" required maxlength="100" value="${h(v.name)}" placeholder="Nombre del proveedor"></label><label>Contacto<input name="contactName" maxlength="100" value="${h(v.contactName)}" placeholder="Ej. Camila"></label><label>WhatsApp<input name="phone" type="tel" value="${h(v.phone)}" placeholder="+56 9 1234 5678"></label><label>Correo de pedidos<input name="email" type="email" value="${h(v.email)}" placeholder="pedidos@proveedor.cl"></label><button class="${v.id ? 'secondary' : 'primary'}">${v.id ? 'Guardar' : 'Agregar proveedor'}</button></form>`).join('')}</div>`
  }
  if (view === 'drafts') {
    app.innerHTML = intro('Pedidos', 'Retoma un pedido guardado o empieza uno nuevo.') + '<p><button class="primary" id="new-draft">Nuevo pedido</button></p>' +
      (state.drafts.filter(d => d.saved || d.lines.length || (d.name && d.name !== 'Pedido nuevo')).map(d => `<article class="card row"><div><h3>N.º ${h(orderNumber(d))}</h3><small>${d.lines.length} líneas · ${clp(totals(d.lines).gross)} con IVA</small><br><span class="tag">${h(orderStatus(d))}</span></div><div class="actions count"><button data-open="${h(d.id)}">Abrir</button><button class="danger" data-delete="${h(d.id)}">Eliminar</button></div></article>`).join('') || '<p class="muted">Aún no hay pedidos guardados.</p>')
  }
  if (view === 'import') renderImport()
  if (view === 'account') renderAccount()
  if (view === 'guide') renderGuide()
}

function renderImport() {
  app.innerHTML = intro('Catálogos', 'Carga una lista para usar sus precios en Comparar. Puedes editarla después.') + (state.vendors.length
    ? `<form id="upload" class="card stack"><div class="fields"><label>Proveedor<select name="vendor" required>${providers()}</select></label></div>
      <label>Archivo<input name="file" type="file" required accept=".pdf,.xlsx,.xls,.csv,.tsv,.ods,.png,.jpg,.jpeg,.webp"></label>
      <small>Para Excel o CSV, usa columnas Producto, Formato, Unidad, Precio neto y Precio con IVA. Los precios corresponden a la unidad de compra.</small>
      <label class="check"><input type="checkbox" name="replace" checked> Reemplazar las ofertas vigentes del proveedor</label>
      <div class="actions"><button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Leyendo…' : 'Cargar catálogo'}</button><button type="button" id="manual" ${busy ? 'disabled' : ''}>Ingreso manual</button><a class="button" href="plantilla.xlsx" download="Plantilla de catálogo.xlsx">Plantilla Excel</a></div></form>`
    : '<div class="card"><p>Agrega un proveedor para cargar su primer catálogo.</p><button class="primary" data-view="vendors">Agregar proveedor</button></div>') +
    (review ? `<section class="card" id="catalog-editor"><h2>${review.catalog ? 'Editar catálogo' : 'Ingreso manual'}</h2><p>${h(review.file)} · ${review.rows.length} filas.</p>
    <div class="review"><table><thead><tr><th>Incluir</th><th>Producto</th><th>Contenido</th><th>Unidad</th><th>Neto por unidad</th><th>Con IVA por unidad</th><th>Disponible</th></tr></thead><tbody>
    ${review.rows.map((r,i) => `<tr data-row="${i}"><td><input type="checkbox" aria-label="Incluir fila ${i+1}" data-field="include" ${r.include ? 'checked' : ''}></td>
      <td><input aria-label="Producto ${i+1}" data-field="name" value="${h(r.name)}">${r.code || r.origin ? `<small>${h([r.code,r.origin].filter(Boolean).join(' · '))}</small>` : ''}</td>
      <td><input inputmode="decimal" aria-label="Contenido ${i+1}" data-field="size" value="${h(r.size)}"></td>
      <td><select aria-label="Unidad ${i+1}" data-field="unit">${options([['kg','kg'],['unidad','unidad']],r.unit)}</select></td>
      <td><input inputmode="numeric" aria-label="Neto ${i+1}" data-field="net" value="${h(r.net || '')}"></td>
      <td><input inputmode="numeric" aria-label="Con IVA ${i+1}" data-field="gross" value="${h(r.gross || '')}"></td>
      <td><input type="checkbox" aria-label="Disponible ${i+1}" data-field="available" ${r.available ? 'checked' : ''}></td></tr>`).join('')}
    </tbody></table></div><div class="actions" style="margin-top:.8rem"><button id="append">Agregar fila</button>
    <button class="primary" id="activate">Guardar catálogo</button><button id="cancel-catalog">Cancelar</button></div></section>` : '') +
    `<section class="card"><h2>Catálogos vigentes</h2>${state.catalogs.map((c, index) => `<div class="item"><div><strong>${h(vendor(c.vendorId)?.name)}</strong><br><small>${h(c.file)} · ${c.rows.length} ofertas · ${h(c.date)}</small></div><div class="actions"><button data-edit-catalog="${index}">Editar catálogo</button><button class="danger" data-delete-catalog="${index}">Eliminar catálogo</button></div></div>`).join('') || '<p class="muted">Aún no hay ofertas cargadas.</p>'}</section>`
}
const newRow = () => ({...offer(), include: true})
function rememberPrices(vendorId, rows) {
  state.lastPrices ??= {}
  const history = state.lastPrices[vendorId] ?? []
  const valid = rows.filter(canOrder)
  state.lastPrices[vendorId] = [
    ...valid.map(({name, size, unit, net, signature, code, origin}) => ({name, size, unit, net, signature, code, origin})),
    ...history.filter(previous => !valid.some(row => samePresentation(previous, row)))
  ]
}
function activate(entry, imported = false) {
  const rows = entry.rows.filter(r => imported || r.include).map(r => {
    const normalized = offer(r.name.trim(), number(r.size), number(r.net, true), number(r.gross, true), r.unit, r.available)
    if (imported && !normalized.net) normalized.available = false
    const previous = entry.catalog?.rows.find(row => row.id === r.id)
    const unchanged = previous && Object.keys(normalized).every(key => previous[key] === normalized[key])
    return {...normalized, code: r.code || '', origin: r.origin || '', id: unchanged ? r.id : id(), signature: signature(r,entry.vendorId)}
  })
  if (imported && !rows.some(canOrder)) {
    notify('No se detectaron ofertas con precio. Revisa el archivo o usa la plantilla Excel.')
    return
  }
  if (!rows.length || rows.some(r => !r.name || r.size <= 0 || (r.available && !r.net))) {
    notify('Completa producto, contenido y precio de las filas disponibles, o desmarca las filas incompletas.')
    return
  }
  const current = allOffers().filter(row => row.vendorId === entry.vendorId && canOrder(row))
  const prior = state.lastPrices?.[entry.vendorId] ?? []
  for (const row of rows) {
    const previous = current.findLast(candidate => samePresentation(candidate, row)) || prior.find(candidate => samePresentation(candidate, row))
    if (canOrder(row) && previous) row.previousNet = entry.catalog && row.net === previous.net ? previous.previousNet : previous.net
  }
  rememberPrices(entry.vendorId, [...rows.filter(canOrder), ...current.filter(previous => !rows.some(row => canOrder(row) && samePresentation(previous, row)))])
  if (entry.catalog) entry.catalog.rows = rows
  else if (entry.replace) state.catalogs = state.catalogs.filter(c => c.vendorId !== entry.vendorId)
  else {
    const entryKey = r => JSON.stringify([r.signature, r.size, r.unit])
    const updated = new Set(rows.map(entryKey))
    for (const catalog of state.catalogs.filter(c => c.vendorId === entry.vendorId)) catalog.rows = catalog.rows.filter(r => !updated.has(entryKey(r)))
    state.catalogs = state.catalogs.filter(c => c.rows.length)
  }
  if (!entry.catalog) state.catalogs.push({vendorId: entry.vendorId, rows, file: entry.file, date: new Date().toLocaleDateString('es-CL')})
  review = null
  save()
  render()
  const missingPrices = imported ? rows.filter(row => !row.net).length : 0
  notify(`${entry.catalog ? 'Catálogo actualizado.' : `Catálogo cargado con ${rows.length} ofertas.`}${missingPrices ? ` ${missingPrices} sin precio quedaron como no disponibles.` : ''}`)
}
document.addEventListener('input', e => {
  const el = e.target
  if (el.id === 'search') { query = el.value; editingAlias = null; excludedVendors.clear(); renderResults() }
  if (el.dataset.filterVendor) {
    if (el.checked) excludedVendors.delete(el.dataset.filterVendor)
    else excludedVendors.add(el.dataset.filterVendor)
    renderResults(false)
  }
  if (el.dataset.field && review) {
    const tr = el.closest('tr')
    const row = review.rows[tr.dataset.row]
    const field = el.dataset.field
    row[field] = el.type === 'checkbox' ? el.checked : el.value
    if (review.catalog && (field === 'net' || field === 'gross')) {
      const other = field === 'net' ? 'gross' : 'net'
      const price = number(el.value, true)
      row[other] = price ? Math.round(field === 'net' ? price * 1.19 : price / 1.19) : ''
      $(`[data-field="${other}"]`, tr).value = row[other]
    }
  }
})
app.addEventListener('change', e => {
  const el = e.target
  if (el.id === 'restore-workspace') {
    const file = el.files?.[0]
    if (file) void restoreWorkspace(file)
    return
  }
  if (el.id === 'order-number') {
    const order = draft()
    const number = el.value.trim()
    if (number && state.drafts.some(other => other.id !== order.id && fold(orderNumber(other)) === fold(number))) {
      notify('Ese número de pedido ya está en uso.')
    } else if (number !== orderNumber(order)) {
      order.numberOverride = number
      save()
    }
    el.value = orderNumber(order)
    return
  }
  if (!el.dataset.qty) return
  const line = draft().lines.find(l => l.id === el.dataset.qty)
  line.qty = Math.min(99999, Math.max(1, Math.trunc(Number(el.value)) || 1))
  el.value = line.qty
  save()
  const group = el.closest('[data-order-vendor]')
  const lines = draft().lines.filter(l => l.vendorId === line.vendorId)
  $('[data-subtotal]', group).innerHTML = totalsHtml(totals(lines))
  const link = $('[data-whatsapp]', group)
  if (link) link.href = whatsapp(vendor(line.vendorId), lines)
  const mail = $('[data-order-email]', group)
  if (mail) mail.href = emailOrder(vendor(line.vendorId), lines)
  $('[data-delivery]', group).innerHTML = deliveryHtml(draft(), line.vendorId)
  $('#order-total').innerHTML = totalsHtml(totals(draft().lines))
  const shortcut = $('#order-shortcut')
  if (shortcut) shortcut.textContent = `Ver pedido · ${clp(totals(draft().lines).gross)}`
})
document.addEventListener('click', e => {
  const link = e.target.closest('a[data-whatsapp], a[data-order-email]')
  if (link) {
    const group = link.closest('[data-order-vendor]')
    const vendorId = group.dataset.orderVendor
    const channel = 'whatsapp' in link.dataset ? 'whatsapp' : 'email'
    const order = draft()
    const version = orderVersion(orderLines(order, vendorId))
    order.deliveries ??= {}
    order.deliveries[vendorId] ??= {}
    const record = order.deliveries[vendorId][channel]
    if (record?.version !== version) order.deliveries[vendorId][channel] = {version, sent: false}
    save()
    $('[data-delivery]', group).innerHTML = deliveryHtml(order, vendorId)
    return
  }
  const button = e.target.closest('button')
  if (!button) return
  const data = button.dataset
  if ('vendorResponse' in data) {
    const vendorId = button.closest('[data-order-vendor]').dataset.orderVendor
    const order = draft()
    responseEditor = {orderId:order.id, vendorId, version:orderVersion(orderLines(order, vendorId))}
    renderCart()
    $('#vendor-response input')?.focus()
    return
  }
  if (button.id === 'cancel-response') {
    responseEditor = null
    renderCart()
    return
  }
  if (button.id === 'backup-workspace') {
    const source = URL.createObjectURL(new Blob([JSON.stringify(state)], {type:'application/json'}))
    const download = Object.assign(document.createElement('a'), {href:source, download:'gestor-pedidos-respaldo.json'})
    download.click()
    setTimeout(() => URL.revokeObjectURL(source), 1000)
    return
  }
  if (button.id === 'sync-now') { void cloud.sync(); return }
  if (button.id === 'log-out' || button.id === 'use-cloud') {
    const useCloud = button.id === 'use-cloud'
    if (useCloud && !confirm('¿Abrir la copia en línea? Los cambios locales que no sincronizaste serán reemplazados.')) return
    button.disabled = true
    const operation = useCloud ? cloud.useRemote() : cloud.logout()
    void operation.catch(error => notify(error.message, true)).finally(() => { button.disabled = false })
    return
  }
  if (button.id === 'save-order') {
    const order = draft()
    const previous = {drafts: state.drafts, active: state.active, saved: order.saved, sequence: state.orderSequence}
    order.saved = true
    freshOrder()
    if (!save()) {
      state.drafts = previous.drafts
      state.active = previous.active
      state.orderSequence = previous.sequence
      order.saved = previous.saved
      return
    }
    query = ''
    editingLine = null
    render()
    notify('Pedido guardado. Puedes abrirlo desde Pedidos.')
    return
  }
  if (data.confirmSend) {
    const group = button.closest('[data-order-vendor]')
    const vendorId = group.dataset.orderVendor
    const order = draft()
    const channel = data.confirmSend
    const record = deliveryState(order, vendorId).find(([name]) => name === channel)?.[1]
    const dialog = $('#send-dialog')
    if (!record || record.sent || dialog.open) return
    $('#send-dialog-message').textContent = `¿Ya enviaste el pedido a ${vendor(vendorId)?.name || 'este proveedor'} por ${channels[channel]}?`
    dialog.returnValue = ''
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'confirm' || draft() !== order ||
          !deliveryState(order, vendorId).some(([name, current]) => name === channel && current === record && !current.sent)) return
      record.sent = true
      if (!save()) { record.sent = false; return }
      const delivery = $('[data-delivery]', group)
      delivery.innerHTML = deliveryHtml(order, vendorId)
      delivery.tabIndex = -1
      delivery.focus()
      notify(orderStatus(order))
    }, {once: true})
    dialog.showModal()
    return
  }
  if (data.view) {
    if (data.view === 'buy') query = ''
    view = data.view
    editingLine = null
    responseEditor = null
    render()
    return
  }
  if (button.id === 'sample' && !state.catalogs.length) {
    let supplier = state.vendors.find(v => fold(v.name).startsWith('terra verde'))
    if (!supplier) {
      supplier = {id: id(), name: 'Terra Verde', phone: ''}
      state.vendors.push(supplier)
    }
    const rows = [[25, 270000], [5, 56000]].map(([size, gross]) => {
      const row = offer('Almendra', size, 0, gross)
      return {...row, id: id(), signature: signature(row, supplier.id)}
    })
    state.catalogs.push({vendorId: supplier.id, rows, file: 'Muestra de Terra Verde · noviembre 2026', date: 'Noviembre 2026'})
    query = 'almendra'
    save()
    render()
  }
  if (data.add) {
    const row = allOffers().find(r => r.id === data.add)
    const line = draft().lines.find(l => l.id === row.id)
    if (line) line.qty = Math.min(line.qty + 1, 99999)
    else draft().lines.push({...row, qty: 1})
    save()
    renderCart()
    notify('Presentación agregada al pedido.')
  }
  if (data.alias) {
    editingAlias = editingAlias === data.alias ? null : data.alias
    renderResults()
    $('#alias-name')?.focus()
  }
  if (button.id === 'cancel-alias' || button.id === 'clear-alias') {
    if (button.id === 'clear-alias') {
      const row = allOffers().find(r => r.id === editingAlias)
      if (row) { delete state.aliases[row.signature]; save() }
    }
    editingAlias = null
    renderResults()
  }
  if (data.editLine) {
    editingLine = data.editLine
    renderCart()
    $('[data-line-editor] select').focus()
  }
  if (button.id === 'cancel-edit') { editingLine = null; renderCart() }
  if (data.editCatalog !== undefined) {
    const catalog = state.catalogs[Number(data.editCatalog)]
    if (!catalog || busy) return
    review = {...catalog, catalog, rows: catalog.rows.map(row => ({...row, include: true}))}
    render()
    $('#catalog-editor').scrollIntoView({block: 'start'})
  }
  if (button.id === 'cancel-catalog') { review = null; render() }
  if (data.deleteCatalog !== undefined) {
    const index = Number(data.deleteCatalog)
    const catalog = state.catalogs[index]
    if (catalog && confirm(`¿Eliminar «${catalog.file}»? Sus ofertas saldrán de la comparación. Los pedidos guardados conservarán sus precios.`)) {
      const otherRows = state.catalogs.filter((entry, i) => i !== index && entry.vendorId === catalog.vendorId).flatMap(entry => entry.rows)
      rememberPrices(catalog.vendorId, catalog.rows.filter(row => !otherRows.some(other => canOrder(other) && samePresentation(row, other))))
      state.catalogs.splice(index, 1)
      if (review?.catalog === catalog) review = null
      save()
      render()
      notify('Catálogo eliminado.')
    }
  }
  if (data.remove) {
    if (editingLine === data.remove) editingLine = null
    draft().lines = draft().lines.filter(l => l.id !== data.remove)
    save(); renderCart()
  }
  if (data.open) { state.active = data.open; query = ''; editingLine = null; view = 'buy'; save(); render() }
  if (data.delete && confirm('¿Eliminar este borrador?')) {
    state.drafts = state.drafts.filter(d => d.id !== data.delete)
    if (!state.drafts.length) freshOrder()
    if (state.active === data.delete) state.active = state.drafts[0].id
    save(); render()
  }
  if (button.id === 'new-draft') {
    freshOrder()
    query = ''
    editingLine = null
    view = 'buy'; save(); render()
  }
  if (button.id === 'manual') {
    const vendorId = $('#upload').elements.vendor.value
    if (!vendorId) { notify('Selecciona el proveedor primero.'); return }
    review = {vendorId, file: 'Ingreso manual', rows: [newRow()], replace: false}
    render()
  }
  if (button.id === 'append') { review.rows.push(newRow()); render(); $('#app tbody tr:last-child [data-field=name]').focus() }
  if (button.id === 'activate' && review && !busy) activate(review)
})
app.addEventListener('submit', async e => {
  e.preventDefault()
  const form = e.target
  const data = new FormData(form)
  if (form.id === 'vendor-response' && responseEditor) {
    acknowledgePrices(responseEditor, data)
    return
  }
  if (form.id === 'business-form' && cloud?.profile()) {
    const name = data.get('businessName').trim()
    if (!name) { notify('Escribe el nombre de tu negocio.'); return }
    const previousName = state.businessName
    state.businessName = name
    if (!save()) { state.businessName = previousName; return }
    render()
    notify('Nombre del negocio guardado.')
    return
  }
  if (form.id === 'accept-invite') {
    const button = $('button', form)
    button.disabled = true
    try {
      await cloud.completeInvite(data.get('password'))
      render()
      notify('Cuenta activada.')
    } catch (error) {
      notify(error.message, true)
    } finally {
      button.disabled = false
    }
    return
  }
  if (form.id === 'account-login') {
    const buttons = [...form.querySelectorAll('button')]
    buttons.forEach(button => { button.disabled = true })
    try {
      const signedIn = await cloud.login(data.get('email').trim(), data.get('password'), e.submitter?.value === 'signup')
      if (!signedIn) notify('Revisa tu correo para confirmar la cuenta e inicia sesión.', true)
    } catch (error) {
      notify(error.message, true)
    } finally {
      buttons.forEach(button => { button.disabled = false })
    }
    return
  }
  if (form.dataset.aliasForm) {
    const row = allOffers().find(r => r.id === form.dataset.aliasForm)
    const alias = data.get('alias').trim()
    if (!row || !fold(alias)) { notify('Escribe un nombre común para la equivalencia.'); return }
    state.aliases[row.signature] = alias
    editingAlias = null
    save()
    renderResults()
    return
  }
  if (form.dataset.lineEditor) {
    const lines = draft().lines
    const index = lines.findIndex(line => line.id === form.dataset.lineEditor)
    if (index < 0) return
    const replacement = alternatives(lines[index]).find(row => row.id === data.get('offer'))
    const qty = Number(data.get('qty'))
    if (!replacement || !Number.isInteger(qty) || qty < 1 || qty > 99999) { notify('Revisa la presentación y la cantidad.'); return }
    const existing = lines.find((line, i) => i !== index && line.id === replacement.id)
    if (existing && existing.qty + qty > 99999) { notify('La cantidad combinada supera los 99.999 unidades.'); return }
    if (existing) {
      existing.qty += qty
      lines.splice(index, 1)
    } else lines[index] = {...replacement, qty}
    editingLine = null
    save(); renderCart(); notify('Pedido actualizado.')
    return
  }
  if ('vendor' in form.dataset) {
    const name = data.get('name').trim()
    const phone = data.get('phone').trim().replace(/[+\s()-]/g, '')
    const email = data.get('email').trim()
    const contactName = data.get('contactName').trim()
    if (!name || (phone && !/^[1-9]\d{7,14}$/.test(phone))) { notify('Ingresa un nombre y, si corresponde, un número internacional válido.'); return }
    const record = vendor(form.dataset.vendor)
    if (record) Object.assign(record,{name,phone,email,contactName})
    else state.vendors.push({id:id(),name,phone,email,contactName})
    save(); render(); notify('Proveedor guardado.')
  }
  if (form.id === 'upload' && !busy) {
    const file = data.get('file')
    const vendorId = data.get('vendor')
    if (!file.size || !vendor(vendorId)) return
    busy = true; render()
    notify('Abriendo catálogo…', true)
    try {
      const rows = await readCatalog(file, message => notify(message, true), vendor(vendorId).name)
      activate({vendorId, file: file.name, rows, replace: data.has('replace')}, true)
    } catch (error) {
      console.error(error)
      if (error.code === 'STARFOOD_BROCHURE') {
        notify('Este PDF de Starfood es un folleto de productos. Carga la lista de precios de Starfood o ingresa los valores manualmente.', true)
      } else if (error.code === 'CATALOG_TIMEOUT') {
        notify(`La lectura se detuvo por tiempo de espera. ${error.message}. Puedes reintentar o usar Excel o CSV.`, true)
      } else {
        notify('No se pudo leer el archivo. Verifica el formato y tu conexión, o usa Ingreso manual.')
      }
    } finally { busy = false; render() }
  }
})
function ensureOrderNumbers(persist = true) {
  const unnumbered = state.drafts.filter(order => !order.numberBase)
  if (!unnumbered.length) return
  unnumbered.forEach(assignOrderNumber)
  if (persist) save()
}
async function restoreWorkspace(file) {
  try {
    const incoming = JSON.parse(await file.text())
    if (!['vendors','catalogs','drafts'].every(key => Array.isArray(incoming?.[key])) ||
        !incoming.aliases || !incoming.drafts.some(order => order.id === incoming.active) ||
        incoming.catalogs.some(catalog => !Array.isArray(catalog.rows)) ||
        incoming.drafts.some(order => !Array.isArray(order.lines))) throw Error('El archivo no es un respaldo válido.')
    const populated = state.vendors.length || state.catalogs.length || state.drafts.some(order => order.lines.length)
    if (populated && !confirm('¿Reemplazar los datos de este espacio por los del respaldo?')) return
    const previous = state
    state = {...incoming, businessName: state.businessName || incoming.businessName}
    if (!save()) { state = previous; return }
    ensureOrderNumbers()
    render()
    notify('Respaldo importado.')
  } catch (error) { notify(error.message, true) }
}
ensureOrderNumbers(!cloud?.profile() || Boolean(cloud.workspace()))
render()
cloud?.init({
  defaults, local:localData,
  apply(snapshot) { state = snapshot; ensureOrderNumbers(false); query = ''; review = null; editingLine = null; editingAlias = null; render() },
  status(message) {
    const label = $('#cloud-status')
    if (label) label.textContent = message
    const resolve = $('#use-cloud')
    if (resolve) resolve.hidden = !cloud.conflict()
  }
})
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
  void navigator.serviceWorker.register('offline.js').catch(() => {})
}
})()
