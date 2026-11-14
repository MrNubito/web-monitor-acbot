function createConnectionGuard({inspect,repair,record=()=>{},interval=60000}){
 let timer,busy=false,stopped=true,last='';
 const report=(status,message)=>{if(status!==last){last=status;record({status,message,at:Date.now()});}};
 async function check(){if(stopped||busy)return;busy=true;try{const state=await inspect();if(state.backend!=='Running'){report(state.backend==='NeedsLogin'?'needs-login':'tailscale-offline',state.backend==='NeedsLogin'?'Sign in to Tailscale again to restore remote access.':'Tailscale is not connected. Local access is still available.');return;}if(state.conflict){report('conflict','Another service is configured in Funnel. Review the Tailscale configuration.');return;}if(!state.ready){await repair();report('repaired','Remote access was configured again automatically.');}else report('ready','Remote access is configured.');}catch(error){report('error',error.message);}finally{busy=false;}}
 return {start(){if(!stopped)return;stopped=false;void check();timer=setInterval(()=>void check(),interval);},stop(){stopped=true;clearInterval(timer);},check};
}
module.exports={createConnectionGuard};
