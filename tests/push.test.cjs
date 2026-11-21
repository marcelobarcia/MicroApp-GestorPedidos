const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('push remains subscribed when the account session expires; logout revokes server first',async()=>{
  let owner={id:'account'}, calls=[], subscriptions=1;
  const storage=new Map();
  const sub={unsubscribe:async()=>{calls.push('browser-unsubscribe'); subscriptions--;}};
  const context={
    globalThis:null, Uint8Array, atob, crypto:require('node:crypto').webcrypto,
    navigator:{userAgent:'test',serviceWorker:{ready:Promise.resolve({pushManager:{getSubscription:async()=>sub}}),addEventListener(){}}},
    PushManager:function(){},Notification:{permission:'granted'},matchMedia:()=>({matches:false}),
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{querySelector:()=>null,addEventListener(){}},setTimeout,
    orderCloud:{profile:()=>owner,pushRequest:async value=>{calls.push(value.action); return {active:true};}}
  };
  context.globalThis=context;
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/push.js'),'utf8'),context);
  const firstId=context.orderPush.deviceId();
  await context.orderPush.refresh();
  owner=null; await context.orderPush.refresh();
  assert.equal(subscriptions,1);
  assert(!calls.includes('unsubscribe'));
  owner={id:'account'};
  await context.orderPush.disconnect();
  assert.deepEqual(calls.slice(-2),['unsubscribe','browser-unsubscribe']);
  assert.notEqual(context.orderPush.deviceId(),firstId);
});

test('service worker shows persistent audible notification and rejects external click targets',async()=>{
  const handlers={},shown=[],opened=[];
  const context={URL,self:{registration:{scope:'https://example.test/app/',showNotification:async(...args)=>shown.push(args)},
    addEventListener:(name,fn)=>handlers[name]=fn,clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}},caches:{},Response};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/offline.js'),'utf8'),context);
  let pending;
  handlers.push({data:{json:()=>({title:'Pedido confirmado',body:'Proveedor',url:'https://other.test/'})},waitUntil:p=>pending=p});
  await pending;
  assert.equal(shown[0][0],'Pedido confirmado');
  assert.equal(shown[0][1].silent,false);
  assert.equal(shown[0][1].data.url,'https://example.test/app/');
  handlers.notificationclick({notification:{close(){},data:shown[0][1].data},waitUntil:p=>pending=p});
  await pending;
  assert.equal(opened[0],'https://example.test/app/');
});

test('iPhone subscription starts inside the tap before any asynchronous network request',async()=>{
  const calls=[], listeners={},storage=new Map();
  const registration={pushManager:{getSubscription:async()=>null,subscribe:()=>{calls.push('subscribe');return Promise.resolve({toJSON:()=>({endpoint:'test'})});}}};
  const context={globalThis:null,Uint8Array,atob,crypto:require('node:crypto').webcrypto,setTimeout,
    navigator:{userAgent:'iPhone',standalone:true,serviceWorker:{ready:Promise.resolve(registration),addEventListener(){}}},
    PushManager:function(){},Notification:{permission:'granted'},matchMedia:()=>({matches:true}),
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{querySelector:()=>null,addEventListener:(name,fn)=>listeners[name]=fn},
    orderCloud:{profile:()=>({id:'account'}),pushRequest:async data=>{calls.push(data.action);return {publicKey:'AQID'};}}
  };
  context.globalThis=context;
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/push.js'),'utf8'),context);
  await context.orderPush.refresh(); calls.length=0;
  const pending=listeners.click({target:{closest:()=>({dataset:{pushAction:'enable'}})}});
  assert.deepEqual(calls,['subscribe']);
  await pending;
  assert.deepEqual(calls,['subscribe','subscribe']);
});

test('edge dispatcher authenticates requests and sends encrypted Web Push without a recipient login',async()=>{
  const ts=require('typescript');
  const webpush=require('web-push');
  const crypto=require('node:crypto');
  const keys=webpush.generateVAPIDKeys();
  const receiver=crypto.createECDH('prime256v1'); receiver.generateKeys();
  const auth=crypto.randomBytes(16);
  const device={id:'22222222-2222-4222-8222-222222222222',owner_id:'owner',active:true,
    subscription:{endpoint:'https://web.push.apple.com/test',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}}};
  const settings={dispatch_token:'internal-only',vapid:keys};
  let handler,providerRequest,completed=false,authChecks=0;
  const source=fs.readFileSync(path.join(root,'supabase/functions/order-push/index.ts'),'utf8').replace("import webpush from 'npm:web-push@3.6.7';",'');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});
  assert.equal(compiled.diagnostics.length,0);
  const fakeFetch=async(url,options={})=>{
    const address=new URL(url);
    if(address.hostname==='web.push.apple.com') {
      providerRequest=options;
      assert.equal(options.redirect,'error');
      assert(options.headers.Authorization || options.headers.authorization);
      assert.equal(options.headers['Content-Encoding'],'aes128gcm');
      assert(!Buffer.from(options.body).includes(Buffer.from('Pedido enviado')));
      return new Response('',{status:201});
    }
    if(address.pathname==='/auth/v1/user') {authChecks++; return new Response('{}',{status:401});}
    const name=address.pathname.split('/').at(-1);
    if(name==='order_push_config') return Response.json([settings]);
    if(name==='claim_order_push_jobs') return Response.json([{id:1,device_id:device.id,attempts:1,payload:{title:'Pedido enviado',body:'Proveedor',orderId:'order'}}]);
    if(name==='order_push_devices') return Response.json([device]);
    if(name==='order_push_jobs' && options.method==='PATCH') {completed=!!JSON.parse(options.body).delivered_at; return Response.json([]);}
    throw Error('Unexpected request '+url);
  };
  vm.runInNewContext(compiled.outputText,{webpush,URL,Response,AbortSignal,console,fetch:fakeFetch,Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://db.test':'service-only'},serve:fn=>handler=fn}});
  const call=(token,action)=>handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action})}));
  assert.equal((await call('bad','dispatch')).status,401);
  assert.equal((await call('expired-user','config')).status,401);
  const result=await call('internal-only','dispatch');
  assert.equal(result.status,200); assert.equal((await result.json()).sent,1);
  assert(providerRequest); assert(completed);
  assert.equal(authChecks,1,'dispatch must not depend on recipient Auth session');
});
