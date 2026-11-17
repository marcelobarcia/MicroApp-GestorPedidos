(() => {
'use strict'
const config = globalThis.orderCloudConfig
const sessionKey = 'gestor-pedidos-session'
const keyFor = owner => 'gestor-pedidos-cloud:' + owner
const read = key => {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value))
let session = read(sessionKey)
let hooks, timer, running, conflict = false
let status = ''
const configured = Boolean(config?.url && config?.publishableKey)
const owner = () => session?.user?.id
const workspace = () => owner() ? read(keyFor(owner())) : null
function report(message) { status = message; hooks?.status(message) }
function saveSession(data) {
  const next = {...data, user: data.user || session?.user, expires_at: Date.now() + data.expires_in * 1000}
  write(sessionKey, next)
  session = next
}
async function request(path, {method = 'GET', body, token, headers = {}} = {}) {
  const response = await fetch(config.url + path, {
    method,
    headers: {apikey: config.publishableKey, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(data?.msg || data?.message || 'No se pudo conectar con Supabase.'), {status: response.status})
  return data
}
async function token() {
  if (session.expires_at <= Date.now() + 60000) {
    saveSession(await request('/auth/v1/token?grant_type=refresh_token', {method:'POST', body:{refresh_token:session.refresh_token}}))
  }
  return session.access_token
}
function local(snapshot) {
  if (!owner()) return false
  const cached = workspace()
  write(keyFor(owner()), {...cached, snapshot, dirty:true})
  schedule()
  return true
}
function schedule() {
  clearTimeout(timer)
  if (configured && owner() && !conflict) timer = setTimeout(sync, 900)
}
async function synchronize() {
  if (!configured || !owner() || conflict) return
  if (!navigator.onLine) { report('Sin conexión. Los cambios quedan en este equipo.'); return }
  report('Sincronizando…')
  const activeOwner = owner()
  const auth = await token()
  const endpoint = '/rest/v1/order_workspaces'
  const filter = 'owner_id=eq.' + encodeURIComponent(activeOwner)
  const [remote] = await request(endpoint + '?' + filter + '&select=revision,snapshot', {token:auth})
  const cached = workspace()
  if (!cached?.dirty) {
    if (remote && remote.revision !== cached?.revision) {
      write(keyFor(activeOwner), {snapshot:remote.snapshot, revision:remote.revision, dirty:false})
      hooks.apply(remote.snapshot)
    }
  } else {
    if ((remote?.revision ?? 0) !== (cached.revision ?? 0)) {
      conflict = true
      report('Otro equipo guardó cambios. Respalda este equipo antes de abrir la copia en línea.')
      return
    }
    const headers = {Prefer:'return=representation'}
    const revision = (cached.revision ?? 0) + 1
    let updated
    try {
      updated = remote
        ? await request(endpoint + '?' + filter + '&revision=eq.' + cached.revision, {method:'PATCH', token:auth, headers, body:{revision,snapshot:cached.snapshot}})
        : await request(endpoint, {method:'POST', token:auth, headers, body:{snapshot:cached.snapshot}})
    } catch (error) {
      if (error.status !== 409) throw error
    }
    if (!updated?.length) {
      conflict = true
      report('Otro equipo guardó cambios. Respalda este equipo antes de abrir la copia en línea.')
      return
    }
    const latest = workspace()
    const dirty = JSON.stringify(latest.snapshot) !== JSON.stringify(cached.snapshot)
    write(keyFor(activeOwner), {snapshot:latest.snapshot, revision, dirty})
    if (dirty) schedule()
  }
  report('Sincronizado.')
}
function sync() {
  if (running) return running
  running = synchronize().catch(error => {
    report(!navigator.onLine ? 'Sin conexión. Los cambios quedan en este equipo.' : 'Sin sincronizar. Puedes reintentar. ' + error.message)
  }).finally(() => { running = null })
  return running
}
async function login(email, password, signup) {
  if (!configured) throw Error('La conexión a Supabase aún no está configurada.')
  if (signup) {
    const data = await request('/auth/v1/signup', {method:'POST', body:{email,password}})
    if (!data?.access_token) return false
    saveSession(data)
  } else {
    saveSession(await request('/auth/v1/token?grant_type=password', {method:'POST', body:{email,password}}))
  }
  conflict = false
  hooks.apply(workspace()?.snapshot ?? hooks.defaults())
  await sync()
  return true
}
async function logout() {
  if (running) await running
  if (workspace()?.dirty) throw Error('Hay cambios pendientes. Sincroniza o descarga un respaldo antes de cerrar la sesión.')
  if (!navigator.onLine) throw Error('Conéctate para cerrar la sesión.')
  await request('/auth/v1/logout?scope=local', {method:'POST', token:await token()})
  localStorage.removeItem(sessionKey)
  session = null
  conflict = false
  status = ''
  hooks.apply(hooks.local())
}
async function useRemote() {
  if (running) await running
  const auth = await token()
  const [remote] = await request('/rest/v1/order_workspaces?owner_id=eq.' + encodeURIComponent(owner()) + '&select=revision,snapshot', {token:auth})
  if (!remote) throw Error('No hay una copia en línea.')
  write(keyFor(owner()), {snapshot:remote.snapshot, revision:remote.revision, dirty:false})
  conflict = false
  hooks.apply(remote.snapshot)
  report('Sincronizado.')
}
function init(callbacks) {
  hooks = callbacks
  if (!configured) return
  addEventListener('online', sync)
  addEventListener('offline', () => { if (owner()) report('Sin conexión. Los cambios quedan en este equipo.') })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync() })
  setInterval(() => { if (!document.hidden) void sync() }, 30000)
  void sync()
}
globalThis.orderCloud = {configured, init, local, sync, login, logout, useRemote, workspace,
  profile: () => session?.user, status: () => status, conflict: () => conflict}
})()
