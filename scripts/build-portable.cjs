const fs=require('fs'),path=require('path'),crypto=require('crypto'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const nodeVersion='v26.13.0';
async function download(url){const response=await fetch(url);if(!response.ok)throw Error('Download failed: '+url+' ('+response.status+')');return Buffer.from(await response.arrayBuffer());}
async function build(){
 const name='ACBot-Web-Monitor-'+version+'-windows-x64',releaseDir=path.join(root,'releases'),target=path.join(releaseDir,name);
 if(fs.existsSync(target)||fs.existsSync(target+'.zip'))throw Error('Build output already exists. Move it aside before rebuilding.');
 const base='https://nodejs.org/dist/'+nodeVersion+'/';console.log('Downloading verified Node.js '+nodeVersion+' Windows x64 runtime…');
 const [runtime,sums,license]=await Promise.all([download(base+'win-x64/node.exe'),download(base+'SHASUMS256.txt'),download('https://raw.githubusercontent.com/nodejs/node/'+nodeVersion+'/LICENSE')]);
 const expected=sums.toString().split(/\r?\n/).find(line=>line.trim().endsWith('win-x64/node.exe'))?.split(/\s+/)[0];
 const digest=crypto.createHash('sha256').update(runtime).digest('hex');if(!expected||expected!==digest)throw Error('Node.js runtime checksum verification failed.');
 fs.mkdirSync(path.join(target,'runtime'),{recursive:true});
 for(const dir of ['service','web','portable'])fs.cpSync(path.join(root,dir),path.join(target,dir),{recursive:true,filter:file=>!fs.lstatSync(file).isSymbolicLink()});
 fs.copyFileSync(path.join(root,'package.json'),path.join(target,'package.json'));fs.mkdirSync(path.join(target,'data'));
 fs.writeFileSync(path.join(target,'runtime','node.exe'),runtime);fs.writeFileSync(path.join(target,'runtime','NODE-LICENSE.txt'),license);
 fs.writeFileSync(path.join(target,'Start ACBot Web Monitor.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nwscript.exe "%~dp0portable\\start.vbs"\r\n');
 fs.writeFileSync(path.join(target,'portable','start.vbs'),'Set shell = CreateObject("WScript.Shell")\r\nSet fso = CreateObject("Scripting.FileSystemObject")\r\nroot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))\r\nshell.Run Chr(34) & root & "\\runtime\\node.exe" & Chr(34) & " " & Chr(34) & root & "\\portable\\launcher.cjs" & Chr(34), 0, False\r\n');
 fs.writeFileSync(path.join(target,'Stop ACBot Web Monitor.cmd'),'@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0portable\\stop.cjs"\r\npause\r\n');
 fs.writeFileSync(path.join(target,'Configure Tailscale Funnel.cmd'),'@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0service\\funnel.cjs"\r\npause\r\n');
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 if(!fs.existsSync(compiler))throw Error('The .NET Framework C# compiler is needed to build the Windows launcher.');
 execFileSync(compiler,['/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/out:'+path.join(target,'ACBot Web Monitor.exe'),path.join(root,'portable','WindowsLauncher.cs')],{windowsHide:true});
 fs.copyFileSync(path.join(target,'ACBot Web Monitor.exe'),path.join(target,'Stop ACBot Web Monitor.exe'));
 fs.copyFileSync(path.join(root,'portable','START-HERE.txt'),path.join(target,'START-HERE.txt'));
 const manifest={product:'ACBot Web Monitor',version,platform:'windows-x64',nodeVersion,nodeSha256:digest,createdAt:new Date().toISOString(),privateDataIncluded:false};fs.writeFileSync(path.join(target,'BUILD.json'),JSON.stringify(manifest,null,2)+'\n');
 execFileSync('tar.exe',['-a','-cf',target+'.zip',name],{cwd:releaseDir,windowsHide:true});
 const zipHash=crypto.createHash('sha256').update(fs.readFileSync(target+'.zip')).digest('hex');fs.writeFileSync(target+'.zip.sha256',zipHash+'  '+name+'.zip\n');
 console.log(JSON.stringify({folder:target,archive:target+'.zip',sha256:zipHash,bytes:fs.statSync(target+'.zip').size},null,2));
}
if(require.main===module)build().catch(error=>{console.error(error.message);process.exitCode=1;});module.exports={build};
