const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const discovery=require('./discovery.cjs');
function createSetupServer({token,configured=()=>false,onFinish,onStop,onHealth=()=>({}),remote,scan=discovery.discover}){
 let finishing=false;
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const server=http.createServer(async(req,res)=>{
  try{
   const expected='127.0.0.1:'+server.address().port;
   if(req.headers.host!==expected)return json(res,403,{error:'Open the local setup address printed by the launcher.'});
   if(req.headers.origin&&req.headers.origin!=='http://'+expected)return json(res,403,{error:'Invalid setup origin.'});
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
   const url=new URL(req.url,'http://'+expected);
   if(!url.pathname.startsWith('/api/')){
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
    const file={'/':'wizard.html','/wizard.js':'wizard.js','/wizard.css':'wizard.css'}[url.pathname];if(!file)return json(res,404,{error:'Not found.'});
    res.writeHead(200,{'Content-Type':file.endsWith('html')?'text/html; charset=utf-8':file.endsWith('css')?'text/css':'text/javascript','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});return res.end(fs.readFileSync(path.join(__dirname,file)));
   }
   const supplied=String(req.headers['x-setup-token']||'');if(supplied.length!==token.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return json(res,401,{error:'Reopen Start ACBot Web Monitor.cmd to access the setup assistant.'});
   let body={};if(req.method==='POST'){let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>100000)throw Error('Request too large.');}body=text?JSON.parse(text):{};}
   if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{app:'ACBot Portable',configured:configured(),...onHealth()});
   if(url.pathname==='/api/stop'&&req.method==='POST'){json(res,200,{ok:true});setImmediate(()=>onStop({pause:url.searchParams.get('pause')==='1'}));return;}
   if(configured())return json(res,409,{error:'Setup is complete. Open the dashboard to change settings.'});
   if(url.pathname==='/api/discover'&&req.method==='POST')return json(res,200,scan({roots:typeof body.root==='string'&&body.root.trim()?[body.root.trim()]:undefined}));
   if(url.pathname==='/api/devices'&&req.method==='POST')return json(res,200,{devices:await discovery.devices(body.adb)});
   if(url.pathname==='/api/probe'&&req.method==='POST'){
    const settings=discovery.validateSettings(body),instance=settings.instances[0];
    const {readStats}=require('../service/stats.cjs');let stats;try{stats=readStats(instance.root);}catch(error){stats={available:false,message:error.message};}
    const result={profiles:fs.readdirSync(path.join(instance.root,'profiles'),{withFileTypes:true}).filter(e=>e.isDirectory()).length,statistics:stats.available?'Statistics found':'No statistics written yet',adb:'Not configured'};
    if(settings.adb&&instance.device){const devices=await discovery.devices(settings.adb);result.adb=devices.some(d=>d.id===instance.device)?'Device connected':'Device is not connected';}
    return json(res,200,result);
   }
   if(url.pathname==='/api/remote'&&req.method==='GET')return json(res,200,remote.state());
   if(url.pathname==='/api/remote'&&req.method==='POST'){remote.start(body.action);return json(res,200,remote.state());}
   if(url.pathname==='/api/finish'&&req.method==='POST'){
    if(finishing)return json(res,409,{error:'Setup is already being saved.'});
    const settings=discovery.validateSettings(body);
    if(typeof body.password!=='string'||body.password.length<12||body.password.length>256)throw Error('Choose a password or phrase with 12 to 256 characters.');
    if(body.remote===true&&!remote.state().ready)throw Error('Complete Tailscale Funnel setup, or choose Local access for now.');
    finishing=true;try{return json(res,200,await onFinish({...settings,password:body.password,remote:body.remote===true}));}finally{finishing=false;}
   }
   return json(res,404,{error:'Endpoint not found.'});
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.end();}
 });return server;
}
module.exports={createSetupServer};
