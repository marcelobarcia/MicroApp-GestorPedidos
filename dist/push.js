(() => {
'use strict'
const cloud = globalThis.orderCloud
const key = 'gestor-pedidos-push-device'
let busy = false
let registered = false
let message = ''
let prepared = null
function deviceId() {
  let value=localStorage.getItem(key)
  if (!value) { value=crypto.randomUUID(); localStorage.setItem(key,value) }
  return value
}
const supported = () => 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis
const encodeKey = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))
async function subscription() {
  const registration=await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}
function panel() {
  return '<section class="card stack account-card" id="push-panel"><h2>Avisos en este celular</h2><p>Recibe un aviso cuando otro equipo envíe o confirme un pedido de esta cuenta, incluso con la pantalla bloqueada.</p><p id="push-state" role="status"></p><div class="actions" id="push-actions"></div><small>El sonido depende de los ajustes del celular. Ambos equipos deben usar la misma cuenta.</small></section>'
}
function paint() {
  const status=document.querySelector('#push-state'), actions=document.querySelector('#push-actions')
  if(!status || !actions) return
  actions.replaceChildren()
  const button=(label,action) => {
    const el=document.createElement('button'); el.textContent=label; el.dataset.pushAction=action; el.disabled=busy || (action==='enable' && !prepared); actions.append(el)
  }
  if(!supported()) status.textContent=/iPhone|iPad|iPod/.test(navigator.userAgent)?'Este iPhone no está ofreciendo notificaciones a esta ventana. Los avisos requieren iOS 16.4 o posterior y abrir Pedidos desde la pantalla de inicio.':'Este navegador no permite avisos. Abre la app desde Safari o Chrome en tu celular.'
  else if(!cloud.profile()) status.textContent='Inicia sesión con la cuenta del negocio para activar los avisos.'
  else {
    status.textContent=message || (registered?'Notificaciones activadas en este celular.':prepared?'Los avisos todavía no están activados en este celular.':'Preparando la activación de avisos…')
    if(registered) { button('Probar en este equipo','test'); button('Desactivar avisos','disable') }
    else { button('Activar notificaciones','enable'); if(!prepared && message) button('Volver a intentar','refresh') }
  }
}
async function refresh() {
  paint()
  if(!supported() || !cloud.profile()) return
  try {
    const [registration,settings]=await Promise.all([navigator.serviceWorker.ready,cloud.pushRequest({action:'config'})])
    prepared={registration,publicKey:settings.publicKey}
    const sub=await subscription()
    if(sub && Notification.permission==='granted') {
      registered=true
      const remote=await cloud.pushRequest({action:'status',deviceId:deviceId()})
      registered=remote.active
    } else registered=false
  } catch { message=registered?'Este celular tiene avisos registrados. No pudimos comprobar la conexión; inicia sesión nuevamente si la app lo pide.':'No pudimos comprobar los avisos. Revisa tu conexión e inicia sesión si es necesario.' }
  paint()
}
async function disconnect() {
  if(!supported()) return
  const sub=await subscription()
  // Revoke on the server first: an explicit logout must stop future deliveries.
  await cloud.pushRequest({action:'unsubscribe',deviceId:deviceId()})
  if(sub) await sub.unsubscribe()
  localStorage.removeItem(key)
  registered=false
  prepared=null
  message='Avisos desactivados en este celular.'
}
document.addEventListener('click', async event => {
  const button=event.target.closest('[data-push-action]')
  if(!button || busy) return
  const action=button.dataset.pushAction
  if(action==='enable' && !prepared) return
  // Safari requires subscribe() itself to run directly in the user's tap.
  // Config and registration have already been loaded before enabling the button.
  const pendingSubscription=action==='enable' ? prepared.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:encodeKey(prepared.publicKey)}) : null
  busy=true; message='Un momento…'; paint()
  try {
    if(action==='refresh') { message=''; await refresh() }
    else if(action==='enable') {
      const sub=await pendingSubscription
      await cloud.pushRequest({action:'subscribe',deviceId:deviceId(),subscription:sub.toJSON()})
      registered=true; message='Notificaciones activadas en este equipo. Pulsa Probar en este equipo para comprobarlas.'
    } else if(action==='disable') await disconnect()
    else if(action==='test') {
      await cloud.pushRequest({action:'test',deviceId:deviceId()})
      message='Aviso enviado. Si no suena, revisa el volumen y No molestar.'
    }
  } catch(error) { message=Notification.permission==='denied'?'Permite las notificaciones para Pedidos en los ajustes del iPhone y vuelve a intentarlo.':error.message || 'No se pudo activar el aviso. Inténtalo de nuevo.' }
  finally { busy=false; paint() }
})
if('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message',event => {
  if(event.data?.type!=='order-push') return
  const banner=document.createElement('div'); banner.className='push-banner'; banner.setAttribute('role','status')
  banner.textContent=event.data.title+' · '+event.data.body
  document.body.append(banner); setTimeout(()=>banner.remove(),8000)
  document.dispatchEvent(new CustomEvent('order-notification',{detail:{orderId:event.data.orderId,confirmed:event.data.title?.startsWith('Pedido confirmado')}}))
})
globalThis.orderPush={deviceId,panel,refresh,disconnect}
})()
