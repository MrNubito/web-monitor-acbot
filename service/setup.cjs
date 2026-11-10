const readline=require('node:readline/promises');
const crypto=require('node:crypto');
const {dataDir}=require('./runtime-host');
const {createAuth}=require('./auth.cjs');
(async()=>{
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  console.log('Web Monitor ACBot — local access setup');
  const answer=await rl.question('Press Enter to generate a strong password, or type your own (12+ characters): ');rl.close();
  const password=answer||crypto.randomBytes(18).toString('base64url');createAuth(dataDir).setPassword(password);
  if(!answer)console.log('Your generated password: '+password);
  console.log('Password saved as a hash in the private data folder. Start with npm start.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
