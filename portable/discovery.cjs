const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
function validRoot(root){try{return fs.statSync(path.join(root,'profiles')).isDirectory()&&fs.readdirSync(root).some(n=>/^(acbot|autoclash).*\.exe$/i.test(n));}catch{return false;}}
function discover({roots,home=process.env.USERPROFILE||'',maxDirectories=5000}={}){
 const starts=roots||['Desktop','Downloads','Documents'].map(n=>path.join(home,n));
 const queue=starts.map(root=>({root,depth:0})),seen=new Set(),instances=[],adb=new Set();let scanned=0;
 while(queue.length&&scanned<maxDirectories){const {root,depth}=queue.shift();const key=path.resolve(root).toLowerCase();if(seen.has(key))continue;seen.add(key);scanned++;
  let entries;try{entries=fs.readdirSync(root,{withFileTypes:true});}catch{continue;}
  if(validRoot(root)){instances.push({root:path.resolve(root),label:path.basename(root),profiles:fs.readdirSync(path.join(root,'profiles'),{withFileTypes:true}).filter(e=>e.isDirectory()).length});for(const sub of ['adb/adb.exe','adb.exe','Tools/adb.exe']){const file=path.join(root,sub);if(fs.existsSync(file))adb.add(file);}continue;}
  if(depth<4)for(const entry of entries)if(entry.isDirectory()&&!entry.isSymbolicLink()&&!/^(node_modules|\.git|data|AppData|Windows|runtime|releases)$/i.test(entry.name))queue.push({root:path.join(root,entry.name),depth:depth+1});
 }
 for(const file of ['C:/LDPlayer/LDPlayer9/adb.exe','C:/LDPlayer/adb.exe','C:/Program Files/BlueStacks_nxt/HD-Adb.exe','C:/Program Files/Netease/MuMuPlayerGlobal-12.0/shell/adb.exe'])if(fs.existsSync(file))adb.add(file);
 return {instances,adb:[...adb],scanned,limited:queue.length>0};
}
function adbFile(file){if(typeof file!=='string'||!/(?:^|[\\/])(?:adb|HD-Adb)\.exe$/i.test(file)||!fs.existsSync(file))throw Error('Choose an existing adb.exe or HD-Adb.exe.');return file;}
const execute=(file,args,binary=false)=>new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:15000,maxBuffer:20*1024*1024,encoding:binary?'buffer':'utf8'},(e,out,err)=>e?reject(Error(String(err||e.message).slice(0,800))):resolve(out)));
async function devices(file){const output=await execute(adbFile(file),['devices','-l']);return String(output).split(/\r?\n/).map(l=>l.match(/^(\S+)\s+device\b(.*)/)).filter(Boolean).map(m=>({id:m[1],description:m[2].trim()}));}
function validateSettings(input){
 if(!input||!Array.isArray(input.instances)||!input.instances.length||input.instances.length>50)throw Error('Add at least one ACBot instance (maximum 50).');
 const ids=new Set(),roots=new Set(),labels=new Set();
 const instances=input.instances.map((item,index)=>{
  const root=path.resolve(String(item.root||'')),label=String(item.label||'').trim(),device=String(item.device||'').trim();
  if(!validRoot(root))throw Error('An ACBot folder must contain an ACBot/AutoClash executable and a profiles folder.');
  if(!label||label.length>80||/[;|=\r\n]/.test(label+root+device))throw Error('Use a label and folder path without ; | = or line breaks.');
  if(labels.has(label.toLowerCase()))throw Error('Choose a different display name for each instance.');labels.add(label.toLowerCase());
  if(roots.has(root.toLowerCase()))throw Error('The same ACBot folder was added twice.');roots.add(root.toLowerCase());
  const id='instance-'+(index+1);ids.add(id);
  return {id,label,root,device,version:item.version==='basic'?'basic':'pro',emulator:['mumu','ldplayer','bluestacks','auto'].includes(item.emulator)?item.emulator:'auto',emulatorIndex:String(item.emulatorIndex||'').replace(/[^0-9]/g,'')};
 });
 const adb=input.adb?adbFile(input.adb):'';
 if(instances.some(i=>i.device)&&!adb)throw Error('Choose ADB to use screenshots, live video and emulator controls.');
 return {instances,adb,lan:input.lan===true,startup:input.startup===true};
}
module.exports={discover,validRoot,devices,adbFile,execute,validateSettings};
