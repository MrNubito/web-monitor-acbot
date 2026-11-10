const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
function createAuth(dataDir,{now=Date.now}={}) {
  const file=path.join(dataDir,'access.json');
  const sessions=new Map(), attempts=new Map();
  function setPassword(password) {
    if(typeof password!=='string'||password.length<12||password.length>256)throw Error('Use a password with 12 to 256 characters.');
    const salt=crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(file,JSON.stringify({salt,hash:crypto.scryptSync(password,salt,64).toString('hex')})+'\n',{mode:0o600});sessions.clear();
  }
  function login(password,ip) {
    let record=attempts.get(ip);
    if(!record||now()-record.at>=15*60000)record={at:now(),count:0};
    if(record.count>=5)throw Object.assign(Error('Too many attempts. Try again in 15 minutes.'),{status:429});
    record.count++;attempts.set(ip,record);
    if(attempts.size>10000)for(const [key,value]of attempts)if(now()-value.at>15*60000)attempts.delete(key);
    if(!fs.existsSync(file))throw Object.assign(Error('Run npm run setup on the PC first.'),{status:503});
    const stored=JSON.parse(fs.readFileSync(file,'utf8'));
    if(typeof password!=='string'||password.length>256||!crypto.timingSafeEqual(crypto.scryptSync(password,stored.salt,64),Buffer.from(stored.hash,'hex')))throw Object.assign(Error('Incorrect password.'),{status:401});
    attempts.delete(ip);const token=crypto.randomBytes(32).toString('base64url');
    for(const [key,value]of sessions)if(value.expires<=now())sessions.delete(key);
    if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
    sessions.set(token,{expires:now()+8*3600000});return {token,expiresIn:8*3600};
  }
  function authorized(req) {
    const token=String(req.headers.authorization||'').replace(/^Bearer /,'');const session=sessions.get(token);
    if(!session||session.expires<=now()){sessions.delete(token);return false;}return token;
  }
  return {setPassword,login,authorized,logout:token=>sessions.delete(token)};
}
module.exports={createAuth};
