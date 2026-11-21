import webpush from 'npm:web-push@3.6.7';

const origin = 'https://marcelobarcia.github.io';
const cors = {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Headers':'authorization, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Vary':'Origin'};
const url = Deno.env.get('SUPABASE_URL')!;
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const base = '/MicroApp-GestorPedidos/';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers:{...cors,'Content-Type':'application/json'}});
async function db(path: string, method='GET', body?: unknown) {
  const response = await fetch(url+'/rest/v1/'+path, {method, headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',Prefer:'return=representation'}, body:body===undefined?undefined:JSON.stringify(body)});
  if (!response.ok) throw new Error('Database operation failed');
  return response.status===204 ? null : await response.json();
}
async function config() {
  let [row] = await db('order_push_config?id=eq.true&select=*');
  if (!row.vapid) {
    await db('order_push_config?id=eq.true&vapid=is.null','PATCH',{vapid:webpush.generateVAPIDKeys()});
    [row] = await db('order_push_config?id=eq.true&select=*');
  }
  return row;
}
function validSubscription(value: any) {
  try {
    const endpoint = new URL(value.endpoint);
    const host = endpoint.hostname;
    return endpoint.protocol==='https:' && endpoint.port==='' && !endpoint.username && !endpoint.password &&
      (host==='fcm.googleapis.com' || host==='updates.push.services.mozilla.com' || host==='web.push.apple.com') &&
      /^[A-Za-z0-9_-]{80,100}={0,2}$/.test(value.keys.p256dh) && /^[A-Za-z0-9_-]{20,30}={0,2}$/.test(value.keys.auth);
  } catch { return false; }
}
async function dispatch(settings: any) {
  const jobs = await db('rpc/claim_order_push_jobs','POST',{});
  let sent=0;
  await Promise.all(jobs.map(async (job: any) => {
    const [device] = await db('order_push_devices?id=eq.'+job.device_id+'&select=*');
    if (!device?.active) {
      await db('order_push_jobs?id=eq.'+job.id,'PATCH',{delivered_at:new Date().toISOString(),last_error:'Device disabled'});
      return;
    }
    try {
      if (!validSubscription(device.subscription)) throw new Error('Invalid endpoint');
      const request = webpush.generateRequestDetails(device.subscription, JSON.stringify({...job.payload,url:base+'?order='+encodeURIComponent(job.payload.orderId||'')}),
        {TTL:86400,urgency:'high',vapidDetails:{subject:origin+base,publicKey:settings.vapid.publicKey,privateKey:settings.vapid.privateKey}});
      const response = await fetch(request.endpoint,{method:'POST',headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(10000)});
      if (response.status===404 || response.status===410) {
        await db('order_push_devices?id=eq.'+device.id,'PATCH',{active:false});
        await db('order_push_jobs?id=eq.'+job.id,'PATCH',{delivered_at:new Date().toISOString(),last_error:'Subscription expired'});
      } else if (response.ok) {
        sent++;
        await db('order_push_jobs?id=eq.'+job.id,'PATCH',{delivered_at:new Date().toISOString(),last_error:null});
      } else throw new Error('Push provider HTTP '+response.status);
    } catch (error) {
      await db('order_push_jobs?id=eq.'+job.id,'PATCH',{last_error:String(error.message).slice(0,160),available_at:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)).toISOString()});
    }
  }));
  return sent;
}
Deno.serve(async req => {
  if (req.method==='OPTIONS') return new Response(null,{headers:cors});
  if (req.method!=='POST') return json({error:'Method not allowed'},405);
  try {
    if (Number(req.headers.get('content-length')||0)>12000) return json({error:'Request too large'},413);
    const input=await req.json();
    const bearer=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
    if (!bearer) return json({error:'Inicia sesión para configurar los avisos.'},401);
    if (input.action==='dispatch') {
      const [settings]=await db('order_push_config?id=eq.true&select=*');
      if (bearer!==settings.dispatch_token) return json({error:'Unauthorized'},401);
      return json({sent:await dispatch(settings.vapid ? settings : await config())});
    }
    const auth=await fetch(url+'/auth/v1/user',{headers:{apikey:secret,Authorization:'Bearer '+bearer}});
    if (!auth.ok) return json({error:'Vuelve a iniciar sesión para configurar los avisos.'},401);
    const user=await auth.json();
    const settings=await config();
    if (input.action==='config') return json({publicKey:settings.vapid.publicKey});
    if (!/^[0-9a-f-]{36}$/i.test(input.deviceId||'')) return json({error:'Dispositivo inválido.'},400);
    const [existing]=await db('order_push_devices?id=eq.'+input.deviceId+'&select=*');
    if (existing && existing.owner_id!==user.id) return json({error:'Este dispositivo pertenece a otra cuenta. Desactiva sus avisos primero.'},403);
    if (input.action==='subscribe') {
      if (!validSubscription(input.subscription)) return json({error:'El navegador no entregó un registro compatible.'},400);
      const record={id:input.deviceId,owner_id:user.id,subscription:input.subscription,active:true,updated_at:new Date().toISOString()};
      if(existing) await db('order_push_devices?id=eq.'+input.deviceId,'PATCH',record);
      else await db('order_push_devices','POST',record);
      return json({active:true});
    }
    if (input.action==='unsubscribe') {
      if(existing) await db('order_push_devices?id=eq.'+input.deviceId,'PATCH',{active:false});
      return json({active:false});
    }
    if (input.action==='status') return json({active:!!existing?.active});
    if (input.action==='test' && existing?.active) {
      const key='test-'+input.deviceId+'-'+Math.floor(Date.now()/30000);
      const queued=await db('order_push_jobs?device_id=eq.'+input.deviceId+'&event_key=eq.'+key+'&select=id');
      if(queued.length) return json({error:'Espera 30 segundos antes de repetir la prueba.'},429);
      await db('order_push_jobs','POST',{device_id:input.deviceId,event_key:key,payload:{title:'Avisos activados',body:'Este celular ya puede recibir avisos de pedidos.',tag:key}});
      await dispatch(settings);
      const [job]=await db('order_push_jobs?device_id=eq.'+input.deviceId+'&event_key=eq.'+key+'&select=delivered_at,last_error');
      return job?.delivered_at && !job.last_error ? json({sent:true}) : json({error:'El aviso quedó pendiente. Revisa el permiso de notificaciones y vuelve a probar.'},502);
    }
    return json({error:'Acción no disponible.'},400);
  } catch (error) {
    console.error('order-push:',error.message);
    return json({error:'No se pudo completar la operación. Inténtalo de nuevo.'},500);
  }
});
