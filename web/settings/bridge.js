(() => {
  const base=()=>sessionStorage.getItem('acbot.agent')||location.origin;
  async function api(route,body){const response=await fetch(base()+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(sessionStorage.getItem('acbot.token')||'')},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'Agent request failed.');return data;}
  const statusListeners=[],logListeners=[],progressListeners=[];let lastLog='';
  const choose=()=>Promise.resolve(prompt('Enter the absolute path on the PC running the agent:')||null);
  window.monitorApp={
    loadConfig:async()=>({...await api('/api/config'),...await api('/api/console').then(s=>({botRunning:s.botRunning}))}),
    saveConfig:config=>api('/api/config',config),pickFolder:choose,pickExe:choose,pickAutoClashPath:choose,
    startBot:()=>api('/api/bot/start',{}),stopBot:()=>api('/api/bot/stop',{}),getBotStatus:()=>api('/api/console').then(s=>({running:s.botRunning})),
    listAndroidDevices:()=>api('/api/android/devices').then(s=>s.devices),
    startAndroid:async(settings,id)=>{progressListeners.forEach(fn=>fn({id,message:'Android Autostart is running on the PC…'}));return api('/api/android/start',{settings,id});},
    cancelAndroidStart:device=>api('/api/android/cancel',{device}),onAndroidStartProgress:fn=>progressListeners.push(fn),
    minimizeWindow(){},toggleMaximizeWindow(){},closeWindow(){},
    onBotLog:fn=>logListeners.push(fn),onBotStatus:fn=>statusListeners.push(fn),
  };
  setInterval(async()=>{try{const state=await api('/api/console');statusListeners.forEach(fn=>fn({running:state.botRunning}));const last=state.logs.at(-1);if(last&&JSON.stringify(last)!==lastLog){lastLog=JSON.stringify(last);logListeners.forEach(fn=>fn(last));}}catch{}},3000);
  const style=document.createElement('style');style.textContent='.titlebar{display:none!important}body{min-width:0!important}.app-shell{min-width:0!important}';document.head.append(style);
})();
