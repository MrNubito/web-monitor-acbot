const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {dataDir}=require('./runtime-host');
async function installTunnel(){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('This installer supports Windows x64. Set CLOUDFLARED_PATH to an official binary for other systems.');
  const response=await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest');
  if(!response.ok)throw Error('Cannot read the official Cloudflare release: '+response.status);
  const release=await response.json();const asset=release.assets.find(item=>item.name==='cloudflared-windows-amd64.exe');
  if(!asset?.digest?.startsWith('sha256:')||!asset.browser_download_url.startsWith('https://github.com/cloudflare/cloudflared/releases/'))throw Error('The official download has no verifiable SHA-256 digest.');
  console.log('Downloading official cloudflared '+release.tag_name+'…');
  const download=await fetch(asset.browser_download_url);if(!download.ok)throw Error('Cloudflare download failed: '+download.status);
  const binary=Buffer.from(await download.arrayBuffer());
  const digest='sha256:'+crypto.createHash('sha256').update(binary).digest('hex');
  if(digest!==asset.digest)throw Error('Cloudflare download checksum mismatch.');
  const binDir=path.join(dataDir,'bin');fs.mkdirSync(binDir,{recursive:true});
  fs.writeFileSync(path.join(binDir,'cloudflared.exe'),binary);
  fs.writeFileSync(path.join(binDir,'cloudflared-version.json'),JSON.stringify({version:release.tag_name,digest,url:asset.browser_download_url},null,2));
  console.log('Cloudflare Tunnel installed. SHA-256 verified. Runtime files stay in the private data folder.');
}
if(require.main===module)installTunnel().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={installTunnel};
