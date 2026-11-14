const fs=require('fs'),path=require('path');
const managed=['service','web','portable','runtime','package.json','BUILD.json','START-HERE.txt','ACBot Web Monitor.exe','Stop ACBot Web Monitor.exe','Start ACBot Web Monitor.cmd','Stop ACBot Web Monitor.cmd','Configure Tailscale Funnel.cmd'];
function version(value){const m=String(value).match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/);if(!m)throw Error('Invalid release version.');return {value:m[0].replace(/^v/,''),main:m.slice(1,4).map(Number),pre:m[4]?.split('.')||[]};}
function compare(a,b){a=version(a);b=version(b);for(let i=0;i<3;i++)if(a.main[i]!==b.main[i])return a.main[i]>b.main[i]?1:-1;if(!a.pre.length||!b.pre.length)return !a.pre.length&&!b.pre.length?0:!a.pre.length?1:-1;for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++){if(a.pre[i]===undefined)return -1;if(b.pre[i]===undefined)return 1;if(a.pre[i]===b.pre[i])continue;const an=/^\d+$/.test(a.pre[i]),bn=/^\d+$/.test(b.pre[i]);return an&&bn?(Number(a.pre[i])>Number(b.pre[i])?1:-1):an!==bn?(an?-1:1):a.pre[i]>b.pre[i]?1:-1;}return 0;}
function inspectZip(buffer,releaseVersion){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('Invalid ZIP archive.');
 const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16),size=buffer.readUInt32LE(end+12);
 if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||count>3000||count===65535||offset+size>end)throw Error('Unsupported or oversized ZIP archive.');
 const prefix='ACBot-Web-Monitor-'+version(releaseVersion).value+'-windows-x64',seen=new Set();let position=offset,total=0;
 for(let i=0;i<count;i++){
  if(position+46>buffer.length||buffer.readUInt32LE(position)!==0x02014b50)throw Error('Invalid ZIP directory.');
  const flags=buffer.readUInt16LE(position+8),method=buffer.readUInt16LE(position+10),length=buffer.readUInt16LE(position+28),extra=buffer.readUInt16LE(position+30),comment=buffer.readUInt16LE(position+32),mode=buffer.readUInt32LE(position+38)>>>16;
  const name=buffer.subarray(position+46,position+46+length).toString('utf8');
  const local=buffer.readUInt32LE(position+42);
  if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50)throw Error('Invalid ZIP local header.');
  const localLength=buffer.readUInt16LE(local+26);
  if(buffer.subarray(local+30,local+30+localLength).toString('utf8')!==name||buffer.readUInt16LE(local+8)!==method)throw Error('Mismatched ZIP local path.');
  if(flags&1||![0,8].includes(method)||![0,0x8000,0x4000].includes(mode&0xf000))throw Error('Encrypted archives and special files are not supported.');
  if(/[\\:\x00]/.test(name)||name.startsWith('/')||name.split('/').some(s=>s==='..'||s==='.'||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))throw Error('Unsafe ZIP path.');
  const parts=name.split('/');if(parts[0]!==prefix||parts.some((s,index)=>!s&&index!==parts.length-1))throw Error('Unexpected ZIP root.');
  const rest=parts.slice(1).join('/');if(rest&&rest!=='data/'&&!managed.includes(parts[1]))throw Error('Unexpected or private files in update.');
  if(parts[1]==='data'&&rest!=='data/')throw Error('An update must never contain user data.');
  const key=name.replace(/\/$/,'').toLowerCase();if(seen.has(key))throw Error('Duplicate ZIP path.');seen.add(key);
  total+=buffer.readUInt32LE(position+24);if(total>800*1024*1024)throw Error('Expanded update is too large.');
  position+=46+length+extra+comment;
 }
 if(position!==offset+size)throw Error('Invalid ZIP directory length.');
 return prefix;
}
function validateBundle(root,expectedVersion){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'BUILD.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 if(manifest.product!=='ACBot Web Monitor'||manifest.platform!=='windows-x64'||manifest.version!==expectedVersion||pkg.version!==expectedVersion)throw Error('This package is not a compatible ACBot Web Monitor release.');
 for(const item of ['service/server.cjs','portable/launcher.cjs','runtime/node.exe','web/index.html','ACBot Web Monitor.exe'])if(!fs.existsSync(path.join(root,item)))throw Error('The update is incomplete: '+item);
 function check(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(fs.lstatSync(file).isSymbolicLink())throw Error('Links are not allowed inside updates.');if(e.isDirectory())check(file);}}
 check(root);return manifest;
}
function target(root,name){if(!managed.includes(name))throw Error('Unmanaged program path.');const result=path.resolve(root,name);if(path.dirname(result)!==path.resolve(root))throw Error('Unsafe program path.');if(fs.existsSync(result)){const real=fs.realpathSync(result);if(real.toLowerCase()!==result.toLowerCase())throw Error('Linked program paths are not supported.');}return result;}
module.exports={managed,version,compare,inspectZip,validateBundle,target};
