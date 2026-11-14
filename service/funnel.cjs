const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const {dataDir}=require('./runtime-host');
const executable=path.join(process.env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe');
const execute=args=>new Promise((resolve,reject)=>execFile(executable,args,{windowsHide:true,timeout:20000},(error,out,err)=>error?reject(Error((out+'\n'+err).trim()||error.message)):resolve(out)));
async function main(){
 if(!fs.existsSync(executable))throw Error('Install Tailscale on this PC first: https://tailscale.com/download/windows');
 const status=JSON.parse(await execute(['status','--json']));
 if(status.BackendState!=='Running')throw Error('Sign in to Tailscale on this PC first. Then run this command again.');
 const hostname=String(status.Self?.DNSName||'').replace(/\.$/,'');
 if(!/^[a-z0-9.-]+\.ts\.net$/i.test(hostname))throw Error('The Tailscale HTTPS hostname is unavailable. Enable MagicDNS for this tailnet.');
 const url='https://'+hostname;
 const target=path.join(dataDir,'network.json');let previous={};try{previous=JSON.parse(fs.readFileSync(target,'utf8'));}catch{}
 fs.writeFileSync(target,JSON.stringify({...previous,publicUrl:url,allowedOrigins:[...new Set([...(previous.allowedOrigins||[]),'https://mrnubito.github.io',url])]},null,2)+'\n');
 console.log('Agent address configured: '+url);
 try{console.log(await execute(['funnel','--bg','--yes','http://127.0.0.1:'+Number(process.env.PORT||17942)]));}
 catch(error){console.log('If Tailscale prints an enablement link, open it and enable Funnel, then run this command again.');throw error;}
 console.log('Open '+url+' directly. Your ACBot password is still required. Keep the PC agent running.');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
