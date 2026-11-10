const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const host=require('./runtime-host'),{createAuth}=require('./auth.cjs'),{readStats}=require('./stats.cjs');
const engine=require('./agent/app/main'),editor=require('./agent/profile-config');
const runtimeTools=import('../web/runtime.js');
const {describeProfile,validateChange,readonly}=require('./profile-fields.cjs');
const {lanHosts}=require('./network.cjs');
const {createVideoService}=require('./video.cjs');
const {createAccountHistory}=require('./account-history.cjs');
const {createTelemetryReader}=require('./telemetry.cjs');
const webDir=path.resolve(__dirname,'../web');
const defaults='DISCORD_TOKEN=\nLOG_FILES=\nAUTOCONTROL_INSTANCES=\nANDROID_APK_INSTANCES=[]\nANDROID_APK_ENABLED=false\nAPP_AUTOSTART_BOT=false\nAUTOCONTROL_ENABLED=false\nMOBILE_CONTROL_ENABLED=false\nMOBILE_CONTROL_HOST=127.0.0.1\nMOBILE_CONTROL_PORT=17942\n';
if(!fs.existsSync(path.join(host.dataDir,'.env')))fs.writeFileSync(path.join(host.dataDir,'.env'),defaults,{mode:0o600});
engine.ensureRuntimeFiles();
const secretKey=key=>/token|password|secret|apiKey/i.test(key);
function createServer({auth=createAuth(host.dataDir)}={}){
  const profileSessions=new Map();
  const video=createVideoService({engine});
  const accountHistory=createAccountHistory({file:path.join(host.dataDir,'account-history.db'),engine,readStats});accountHistory.start();
  let telemetryReader;
  async function telemetry(){const helpers=await runtimeTools;telemetryReader||=createTelemetryReader({engine,readStats,runtimeFromStats:helpers.runtimeFromStats});return telemetryReader();}
  const network=()=>{try{return JSON.parse(fs.readFileSync(path.join(host.dataDir,'network.json'),'utf8'));}catch{return {};}};
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>1024*1024)throw Object.assign(Error('Request too large.'),{status:413});}try{return text?JSON.parse(text):{};}catch{throw Object.assign(Error('Invalid JSON.'),{status:400});}}
  const publicConfig=()=>Object.fromEntries(Object.entries(engine.configFromEnv()).map(([k,v])=>[k,secretKey(k)?'':v]));
  function instance(id){const found=engine.findMobileInstance(engine.mobileConfig(),decodeURIComponent(id));if(!found)throw Object.assign(Error('Instance not found.'),{status:404});return found;}
  function profileView(id,profile,token){
    for(const [key,value]of profileSessions)if(value.expires<Date.now())profileSessions.delete(key);
    if(profileSessions.size>=100)profileSessions.delete(profileSessions.keys().next().value);
    const root=engine.resolveAutoClashRootPath(instance(id));
    const snapshot=editor.readProfile(root,decodeURIComponent(profile));
    const sid=crypto.randomBytes(20).toString('hex');
    profileSessions.set(sid,{...snapshot,root,profile:decodeURIComponent(profile),instanceId:id,owner:token,expires:Date.now()+30*60000});
    return {session:sid,profile:decodeURIComponent(profile),...describeProfile(snapshot.config)};
  }
  const server=http.createServer(async(req,res)=>{
    try{
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
      const cfg=network();
      const allowedOrigins=new Set([...(cfg.allowedOrigins||[]),...(process.env.WEB_ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
      const publicUrl=process.env.WEB_PUBLIC_URL||cfg.publicUrl;
      const trustedHosts=new Set(['127.0.0.1','localhost','[::1]',...lanHosts()]);if(publicUrl)trustedHosts.add(new URL(publicUrl).hostname);
      const url=new URL(req.url,'http://'+(req.headers.host||'localhost'));
      if(!trustedHosts.has(url.hostname))return json(res,403,{error:'Host is not configured. Set publicUrl in data/network.json.'});
      const origin=req.headers.origin;
      if(origin&&origin!==url.origin&&!allowedOrigins.has(origin))return json(res,403,{error:'This website origin is not allowed.'});
      if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});return res.end();}
      if(url.pathname==='/api/login'&&req.method==='POST'){const {password}=await body(req);return json(res,200,auth.login(password,req.socket.remoteAddress));}
      if(url.pathname.startsWith('/api/')){
        const token=auth.authorized(req);if(!token)return json(res,401,{error:'Sign in to your PC agent.'});
        if(url.pathname==='/api/password'&&req.method==='POST'){const {currentPassword,newPassword}=await body(req);if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>256)throw Error('Use a password or phrase with 12 to 256 characters.');auth.login(currentPassword,req.socket.remoteAddress);auth.setPassword(newPassword);return json(res,200,auth.login(newPassword,req.socket.remoteAddress));}
        if(url.pathname==='/api/logout'&&req.method==='POST'){auth.logout(token);return json(res,200,{ok:true});}
        if(url.pathname==='/api/accounts'&&req.method==='GET')return json(res,200,accountHistory.view({instance:url.searchParams.get('instance')||undefined,range:['today','week','all'].includes(url.searchParams.get('range'))?url.searchParams.get('range'):'today',profile:url.searchParams.get('profile')||undefined}));
        if(url.pathname==='/api/telemetry'&&req.method==='GET')return json(res,200,await telemetry());
        if(url.pathname==='/api/status'&&req.method==='GET'){
          const config=engine.mobileConfig();
          const instances=await engine.getMobileInstancesStatus(config);
          const samples=await telemetry();
          for(const current of instances){
            const sample=samples.instances.find(item=>item.id===current.id);
            current.runtime=sample?.runtime||{available:false,seconds:null,label:'—'};current.runtimeSource=sample?.snapshot.source||null;
          }
          return json(res,200,{app:'ACBot Web Monitor',botRunning:engine.botRunning(),adbConnected:instances.some(i=>i.adbConnected),ldPlayerRunning:instances.some(i=>i.ldPlayerRunning),instances,logs:engine.mobileLogsConfig().map(engine.mobileLogSummary)});
        }
        if(url.pathname==='/api/config'){
          if(req.method==='GET')return json(res,200,publicConfig());
          if(req.method==='POST'){
            const next=await body(req),previous=engine.configFromEnv();
            for(const key of Object.keys(previous))if(secretKey(key)&&!next[key])next[key]=previous[key];
            engine.writeEnv({...previous,...next});return json(res,200,publicConfig());
          }
        }
        if(url.pathname==='/api/console'&&req.method==='GET')return json(res,200,{logs:host.logs,botRunning:engine.botRunning()});
        if(url.pathname==='/api/android/devices'&&req.method==='GET')return json(res,200,{devices:await host.handlers.get('android:devices')()});
        if(url.pathname==='/api/android/start'&&req.method==='POST'){const data=await body(req);return json(res,200,await host.handlers.get('android:autostart')(null,data.settings||engine.configFromEnv(),data.id));}
        if(url.pathname==='/api/android/cancel'&&req.method==='POST'){const data=await body(req);return json(res,200,await host.handlers.get('android:autostart-cancel')(null,data.device));}
        const videoMatch=url.pathname.match(/^\/api\/instances\/([^/]+)\/video$/);
        if(videoMatch&&req.method==='GET')return await video.stream(instance(videoMatch[1]),req,res);
        const stats=url.pathname.match(/^\/api\/instances\/([^/]+)\/stats$/);
        if(stats&&req.method==='GET'){const root=engine.resolveAutoClashRootPath(instance(stats[1]));if(!root)return json(res,200,{available:false,message:'Configure the ACBot folder first.'});return json(res,200,readStats(root,url.searchParams.get('period')==='daily'?'daily':'session'));}
        const profileList=url.pathname.match(/^\/api\/instances\/([^/]+)\/profiles$/);
        if(profileList&&req.method==='GET'){
          const selected=instance(profileList[1]),root=engine.resolveAutoClashRootPath(selected);
          const profiles=engine.listMobileProfiles(selected).map(item=>{
            let metadata={townHall:null,builderHall:null};
            if(item.available)try{metadata=describeProfile(editor.readProfile(root,item.id).config).metadata;}catch{}
            return {...item,metadata,label:item.name+(metadata.townHall?' · TH '+metadata.townHall:'')};
          });return json(res,200,{profiles});
        }
        const profile=url.pathname.match(/^\/api\/instances\/([^/]+)\/profiles\/([^/]+)\/config$/);
        if(profile){
          if(req.method==='GET')return json(res,200,profileView(profile[1],profile[2],token));
          if(req.method==='POST'){
            const data=await body(req),session=profileSessions.get(data.session);
            if(!session||session.expires<Date.now()||session.owner!==token||session.instanceId!==profile[1]||session.profile!==decodeURIComponent(profile[2]))return json(res,409,{error:'The editor session expired. Reload the profile.'});
            if(!data.changes||Array.isArray(data.changes)||typeof data.changes!=='object')throw Error('Invalid changes.');
            const changes=new Map();for(const [key,value]of Object.entries(data.changes)){
              if(!Object.hasOwn(session.config,key)||!editor.editable(key)||readonly.has(key))throw Error('Invalid option.');
              validateChange(describeProfile(session.config).fields.find(f=>f.key===key),value);
              const previous=session.config[key];
              if(typeof previous==='boolean'){if(typeof value!=='boolean')throw Error('Expected Enabled or Disabled.');changes.set(key,value);}
              else changes.set(key,editor.parseValue(previous,typeof value==='string'?value:JSON.stringify(value)));
            }
            try{const backup=changes.size?editor.saveProfile({...session,changes}):null;profileSessions.delete(data.session);return json(res,200,{ok:true,backup:backup?path.basename(backup):null,...profileView(profile[1],profile[2],token)});}
            catch(error){return json(res,409,{error:error.message});}
          }
        }
        const restart=url.pathname.match(/^\/api\/instances\/([^/]+)\/restart$/);
        if(restart&&req.method==='POST'){const selected=instance(restart[1]),config=engine.mobileConfig();await engine.runMobileAction(config,selected,'closeexe');await engine.runMobileAction(config,selected,'openexe');await engine.runMobileAction(config,selected,'start');return json(res,200,{ok:true,output:'ACBot restarted and Start pressed.'});}
        // The legacy agent remains behind authentication. It never opens a second HTTP listener.
        const allowed=/^\/api\/(status|logs(?:\/[^/]+\/tail)?|notifications|bot\/(start|stop)|instances\/[^/]+\/(actions|profiles|screen|live-view|live-h264)|fullscreen)$/;
        if(allowed.test(url.pathname))return await engine.handleMobileRequest(req,res);
        return json(res,404,{error:'Endpoint not found.'});
      }
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
      const decoded=decodeURIComponent(url.pathname),requested=decoded.endsWith('/')?decoded+'index.html':decoded;
      const file=path.resolve(webDir,'.'+requested);
      if(!file.startsWith(webDir+path.sep))return json(res,403,{error:'Invalid path.'});
      const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json'};
      if(!fs.existsSync(file)||!fs.statSync(file).isFile()||!types[path.extname(file)])return json(res,404,{error:'Not found.'});
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-cache'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
    }catch(error){if(!res.headersSent)json(res,error.status||400,{error:error.message});else res.end();}
  });
  server.on('close',()=>{video.stopAll();accountHistory.close();});
  server.stopVideo=()=>video.stopAll();
  return server;
}
if(require.main===module){
  const port=Number(process.env.PORT||17942),server=createServer();
  const lan=process.argv.includes('--lan');
  server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{console.log('Web Monitor ACBot: http://127.0.0.1:'+port);if(lan)for(const address of lanHosts())console.log('Local network: http://'+address+':'+port);});
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.stopVideo();engine.stopAll();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
module.exports={createServer};
