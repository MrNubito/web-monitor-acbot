function validateMonitorConfig(config){
 const fail=message=>{throw Object.assign(Error(message),{status:400,code:'MONITOR_CONFIG_INVALID'});};
 if(!String(config.discordToken||'').trim())fail('Add your Discord bot token in Settings → Discord before starting the Discord monitor. The web dashboard works without it.');
 if(!/^\d{15,22}$/.test(String(config.fallbackChannelId||'').trim()))fail('Add a valid Fallback channel ID in Settings → Discord before starting the Discord monitor. The web dashboard works without Discord.');
 let instances=[];try{instances=JSON.parse(config.androidApkInstances||'[]');}catch{fail('Check your Android APK instance settings.');}
 if(!(config.logs||[]).some(log=>String(log.name||'').trim()&&String(log.path||'').trim())&&!(String(config.androidApkEnabled)==='true'&&Array.isArray(instances)&&instances.length))fail('Configure a log folder or enable an Android APK instance before starting the Discord monitor.');
 return true;
}
module.exports={validateMonitorConfig};
