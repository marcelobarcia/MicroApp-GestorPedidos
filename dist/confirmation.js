(() => {
'use strict'
const version = lines => JSON.stringify(lines.map(({id,qty,net,gross})=>[id,qty,net,gross]))
const confirmed = (order,vendorId) => {
  const agreement=order.agreements?.[vendorId]
  return agreement?.version===version(order.lines.filter(line=>line.vendorId===vendorId)) ? agreement : null
}
function received(previous,next) {
  return next.drafts.filter(order=>{
    const before=previous.drafts.find(item=>item.id===order.id)
    if(!before) return false // Loading an account or importing history is not a new confirmation.
    return Object.keys(order.agreements||{}).some(vendorId=>{
      const agreement=confirmed(order,vendorId)
      return agreement && agreement.version!==confirmed(before,vendorId)?.version
    })
  }).map(order=>order.id)
}
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const clp=value=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(value)
const fmt=value=>new Intl.NumberFormat('es-CL',{maximumFractionDigits:4}).format(value)
function html(order,vendors,number) {
  const groups=[...new Set(order.lines.map(line=>line.vendorId))]
  const accepted=groups.filter(vendorId=>confirmed(order,vendorId))
  if(!accepted.length) return ''
  let net=0,gross=0
  const details=accepted.map(vendorId=>{
    const agreement=confirmed(order,vendorId)
    const name=vendors.find(item=>item.id===vendorId)?.name || 'Proveedor'
    const lines=order.lines.filter(line=>line.vendorId===vendorId)
    return `<section class="confirmation-supplier"><h3>${h(name)}</h3><p class="tag">${agreement.changed?'Confirmado con cambios':'Confirmado sin cambios'}</p>
      ${lines.map(line=>{
        net+=line.net*line.qty; gross+=line.gross*line.qty
        const quantity=line.size===1?`${fmt(line.qty)} ${h(line.unit)}`:`${fmt(line.qty)} × ${fmt(line.size)} ${h(line.unit)} · ${fmt(line.qty*line.size)} ${h(line.unit)} en total`
        const before=agreement.original?.find(item=>item.id===line.id)
        const change=before && before.gross!==line.gross?`<small>Antes ${clp(before.gross)} → acordado ${clp(line.gross)} con IVA por presentación</small>`:''
        return `<article class="confirmation-product"><strong>${h(line.name)}</strong><span>${quantity}</span><span>${clp(line.gross)} con IVA por ${line.size===1?h(line.unit):'presentación'}</span>${change}<strong>Subtotal: ${clp(line.gross*line.qty)} con IVA</strong></article>`
      }).join('')}</section>`
  }).join('')
  const pending=groups.length-accepted.length
  return `<h2 id="confirmation-title">Pedido confirmado${pending?' parcialmente':''}</h2><p>N.º ${h(number)}</p>${details}
    <section class="confirmation-total"><span>Neto ${clp(net)}</span><span>IVA ${clp(gross-net)}</span><strong>Total confirmado: ${clp(gross)}</strong></section>
    ${pending?`<p>Falta la confirmación de ${pending} ${pending===1?'proveedor':'proveedores'}.</p>`:''}
    <form method="dialog"><button class="primary" value="close" autofocus>Entendido</button></form>`
}
globalThis.orderConfirmation={received,html}
})()
