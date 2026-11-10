import { createPerformanceHistory, performanceSvg } from './performance-chart.js';
import { createLiveView } from './live-view.js';
import { icon, hydrateIcons } from './icons.js';
const $=id=>document.getElementById(id);
const localAgentOrigin=['localhost','127.0.0.1','[::1]'].includes(location.hostname)?location.origin:'';
let base=sessionStorage.getItem('acbot.agent')||localAgentOrigin,token=sessionStorage.getItem('acbot.token')||'',status=null,period='session',page='overview',stats=null,profile=null,category='',paused=false,logLines=[],screenshotUrl=null;
const changes=new Map();
const performanceHistory=createPerformanceHistory();
const metrics=[['Gold','gold_gained','coin','gold'],['Elixir','elixir_gained','drop','elixir'],['Dark elixir','dark_gained','dark','dark'],['Attacks','total_attacks','swords','attacks'],['Donations','donations_completed','donate','donations'],['Walls upgraded','walls_upgraded','wall','walls']];
const resourceImages={gold:'assets/resource-gold.webp',elixir:'assets/resource-elixir.webp',dark:'assets/resource-dark-elixir.webp',attacks:'assets/resource-attacks.png',donations:'assets/resource-donations.png',walls:'assets/resource-walls.png'};
const compact=v=>v==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(v);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6000);}
function connected(on){if(!on)stopScreen('Agent disconnected');$('connectionBadge').textContent=on?'Agent online':'Offline';$('connectionBadge').classList.toggle('on',on);$('sideDot').classList.toggle('on',on);$('agentState').replaceChildren(document.createTextNode(on?'PC agent connected':'Agent disconnected'));const small=document.createElement('small');small.textContent='Your PC is the control center';$('agentState').append(small);$('connectionButton').textContent=on?'Connection settings':'Connect agent';}
async function api(route,options={}){
  if(!base)throw Error('Connect your PC agent to use this feature.');
  const res=await fetch(base+route,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...options.headers}});
  if(!res.ok){const error=await res.json().catch(()=>({error:res.statusText}));if(res.status===401){connected(false);$('agentUrl').value=base;if(!$('connectDialog').open)$('connectDialog').showModal();}throw Error(error.error||'Request failed.');}return res;
}
const data=async(route,options)=> (await api(route,options)).json();
const post=(route,payload={})=>data(route,{method:'POST',body:JSON.stringify(payload)});
let frameBlob=null,snapshotAbort=null,mediaGeneration=0;
function showFrame(blob){
  if(!blob.size||!blob.type.startsWith('image/'))throw Error('The agent did not return an emulator image.');
  const previous=screenshotUrl;screenshotUrl=URL.createObjectURL(blob);frameBlob=blob;
  $('screenshot').src=screenshotUrl;$('screenshot').hidden=false;$('screenStage').querySelector('.empty').hidden=true;
  $('downloadCapture').disabled=false;if(previous)URL.revokeObjectURL(previous);
}
const liveView=createLiveView({
  capture:async(id,signal)=>(await api('/api/instances/'+encodeURIComponent(id)+'/screen',{signal})).blob(),
  render:showFrame,interval:()=>Number($('liveInterval').value),
  onState:(state,message)=>{
    const running=state==='live'||state==='connecting';
    const liveLabel=icon(running?'stop':'live')+(running?' Stop live':' Live view');$('liveToggle').innerHTML=liveLabel;$('liveQuick').innerHTML=liveLabel;
    $('liveToggle').classList.toggle('is-live',running);$('previewBadge').classList.toggle('on',running);
    $('previewBadge').textContent=state==='live'?'● LIVE':state==='connecting'?'Connecting…':state==='error'?'Unavailable':'Snapshot';
    $('captureTime').textContent=message;$('previewMode').textContent=running?'Live frames · authenticated':'Authenticated · private';
    if(state==='error')toast(message);
  }
});
function stopScreen(message){mediaGeneration++;snapshotAbort?.abort();snapshotAbort=null;liveView.stop(message);}
function toggleLive(){
  if(liveView.active){stopScreen('Live view stopped');return;}
  const instance=selected();if(!instance){toast('Select an emulator instance first.');return;}
  mediaGeneration++;snapshotAbort?.abort();snapshotAbort=null;liveView.start(instance.id);
}
async function takeScreenshot(){
  const instance=selected();if(!instance)return;stopScreen('Capturing screenshot…');
  const generation=mediaGeneration,controller=new AbortController();snapshotAbort=controller;
  $('capture').disabled=true;$('captureQuick').disabled=true;
  try{const response=await api('/api/instances/'+encodeURIComponent(instance.id)+'/screen',{signal:controller.signal});const blob=await response.blob();if(generation!==mediaGeneration)return;showFrame(blob);$('captureTime').textContent='Captured '+new Date().toLocaleTimeString();}
  catch(error){if(!controller.signal.aborted){$('captureTime').textContent='Screenshot unavailable';toast(error.message);}}
  finally{if(snapshotAbort===controller)snapshotAbort=null;renderInstance();}
}
function selected(){return status?.instances.find(i=>i.id===$('instanceSelect').value);}
function drawMetrics(){const values=stats?.available?stats.stats:{};$('metrics').innerHTML=metrics.map(([label,key,symbol,variant])=>`<div class="metric ${variant}"><div class="metric-label"><span class="metric-symbol ${resourceImages[variant]?'resource-image':''}">${resourceImages[variant]?`<img src="${resourceImages[variant]}" alt="" width="28" height="28">`:icon(symbol)}</span>${label}</div><div class="metric-value" title="${values[key]==null?'No data':esc(new Intl.NumberFormat('en-US').format(values[key]))}">${compact(values[key])}</div><small>${values[key]==null?'Waiting for ACBot data':period==='daily'?'Latest recorded day':'This session'}</small></div>`).join('');$('statsSource').textContent=stats?.available?`${stats.source} · ${stats.date||'Latest recorded session'} · Updated from ACBot`:(stats?.message||'Statistics are read directly from ACBot.');
  if(stats?.available&&selected()){
    const key=selected().id+':'+period+':'+(period==='daily'?(stats.date||stats.stats.day_key||''):(stats.stats.session_key||''));
    $('performancePlot').innerHTML=performanceSvg(performanceHistory.record(key,stats.stats));
  }else $('performancePlot').innerHTML='<div class="empty compact">Waiting for performance data.</div>';
  $('chartPeriodLabel').textContent=period==='daily'?'(daily totals)':'(current session)';
}
function fillSelect(select,items,placeholder){const previous=select.value;select.innerHTML=items.length?items.map(i=>`<option value="${esc(i.id)}">${esc(i.label||i.name)}</option>`).join(''):`<option value="">${placeholder}</option>`;if(items.some(i=>i.id===previous))select.value=previous;}
function renderInstance(){
  const instance=selected(),instances=status?.instances||[];
  $('instanceName').textContent=instance?.label||'No instance selected';$('instanceBadge').textContent=instance?.adbConnected?'Online':'Offline';$('instanceBadge').classList.toggle('on',!!instance?.adbConnected);
  $('instanceDescription').textContent=instance?`${instance.version==='basic'?'ACBot Basic':'ACBot Pro'} · ${instance.device||'ADB device not configured'}`:'Choose an instance to manage your bot.';
  $('screenInstance').textContent=instance?instance.label+' · '+(instance.adbConnected?'Emulator connected':'Waiting for emulator'):'Select an instance to get a closer look';
  $('fleetCount').textContent=instances.length?instances.filter(i=>i.adbConnected).length+' / '+instances.length+' ONLINE':'NO INSTANCES CONFIGURED';
  $('instanceFleet').innerHTML=instances.length?instances.map(i=>`<button class="instance-chip ${i.id===instance?.id?'selected':''}" data-instance="${esc(i.id)}" aria-pressed="${i.id===instance?.id}"><span class="chip-icon">${icon('monitor')}</span><span class="chip-copy"><strong>${esc(i.label)}</strong><small><i class="${i.adbConnected?'on':''}"></i>${i.adbConnected?'Emulator online':'Emulator offline'}</small></span><span class="chip-arrow">${icon('chevron')}</span></button>`).join(''):'<div class="fleet-empty">Connect your PC agent to load your instances.</div>';
  $('instancesGrid').innerHTML=instances.length?instances.map(i=>`<section class="instance-card"><div class="instance-card-icon">${icon('monitor')}</div><h2>${esc(i.label)}</h2><span class="badge ${i.adbConnected?'on':''}">${i.adbConnected?'Emulator online':'Emulator offline'}</span><p>${i.version==='basic'?'ACBot Basic':'ACBot Pro'}<br>${esc(i.device||'ADB device not configured')}</p><button class="primary" data-open-instance="${esc(i.id)}">Open controls ${icon('arrow')}</button></section>`).join(''):'<div class="empty">Connect your PC agent to load your instances.</div>';
  document.querySelectorAll('[data-action]').forEach(b=>b.disabled=!instance);$('capture').disabled=!instance||!!snapshotAbort;$('captureQuick').disabled=!instance||!!snapshotAbort;$('liveQuick').disabled=!instance;$('liveToggle').disabled=!instance;
}
let refreshBusy=false;
async function refresh(){if(!token||refreshBusy)return;refreshBusy=true;try{status=await data('/api/status');connected(true);fillSelect($('instanceSelect'),status.instances,'No instances configured');fillSelect($('profileInstance'),status.instances,'Configure an instance first');fillSelect($('logSelect'),[{id:'console',name:'Monitor console'},...status.logs.map(l=>({id:l.name,name:l.name}))],'No logs');$('botState').textContent=status.botRunning?'Monitor running':'Monitor stopped';$('botDot').classList.toggle('on',status.botRunning);$('lastUpdated').textContent='Last checked '+new Date().toLocaleTimeString();renderInstance();await refreshStats();await consoleActivity();}catch(error){connected(false);toast(error.message);}finally{refreshBusy=false;}}
async function refreshStats(){const instance=selected();const result=instance?await data(`/api/instances/${encodeURIComponent(instance.id)}/stats?period=${period}`).catch(error=>({message:error.message})):null;if(selected()?.id!==instance?.id)return;stats=result;drawMetrics();}
async function consoleActivity(){const result=await data('/api/console');const events=result.logs.slice(-4).reverse();$('activityList').className=events.length?'':'empty compact';$('activityList').innerHTML=events.length?events.map(event=>`<div class="activity-line"><time>${esc(new Date(event.time).toLocaleTimeString())}</time><span>${esc(event.text)}</span></div>`).join(''):icon('logs')+'<strong>A quiet moment.</strong><p>New monitor events will appear here.</p>';}
async function showLogs(){if(!token||paused||page!=='logs')return;try{const source=$('logSelect').value;let result;if(source==='console'){result=await data('/api/console');logLines=result.logs.map(l=>`[${new Date(l.time).toLocaleTimeString()}] ${l.text}`);}else{result=await data('/api/logs/'+encodeURIComponent(source)+'/tail?lines=100');logLines=result.available?result.lines.split('\n'):['The log file is not available yet.'];}$('logTitle').textContent=source==='console'?'monitor / console':source;drawLogs();}catch(error){$('logContent').textContent=error.message;}}
function drawLogs(){const filter=$('logSearch').value.toLowerCase();const lines=logLines.filter(l=>l.toLowerCase().includes(filter));$('logContent').textContent=lines.join('\n')||'No matching log messages.';$('logCount').textContent=lines.length+' lines';$('logContent').scrollTop=$('logContent').scrollHeight;}
async function loadProfiles(){if(changes.size&&!confirm('Discard the unsaved profile changes?'))return;changes.clear();profile=null;updateSave();const id=$('profileInstance').value;if(!id)return;try{const result=await data(`/api/instances/${encodeURIComponent(id)}/profiles`);fillSelect($('profileSelect'),result.profiles.filter(p=>p.available),'No profiles available');await loadProfile();}catch(error){$('profileFields').textContent=error.message;}}
async function loadProfile(){if(changes.size&&!confirm('Discard the unsaved profile changes?'))return;const id=$('profileInstance').value,name=$('profileSelect').value;if(!id||!name)return;try{profile=await data(`/api/instances/${encodeURIComponent(id)}/profiles/${encodeURIComponent(name)}/config`);changes.clear();category=profile.fields[0]?.category||'';$('profileNotice').hidden=true;$('restartInstance').hidden=true;drawProfile();updateSave();}catch(error){toast(error.message);}}
function drawProfile(){if(!profile)return;const categories=[...new Set(profile.fields.map(f=>f.category))];$('profileCategories').innerHTML=categories.map(c=>`<button class="${c===category?'active':''}" data-category="${esc(c)}">${esc(c)}<span class="category-count">${profile.fields.filter(f=>f.category===c).length}</span></button>`).join('');const search=$('profileSearch').value.toLowerCase();const fields=profile.fields.filter(f=>(search?f.label.toLowerCase().includes(search)||f.key.toLowerCase().includes(search):f.category===category));const rows=fields.map((f,index)=>{
  const value=changes.has(f.key)?changes.get(f.key):f.value;let input;
  if(typeof f.value==='boolean'){input=`<label class="boolean-control"><span>${value?'Enabled':'Disabled'}</span><input type="checkbox" role="switch" data-field="${esc(f.key)}" aria-label="${esc(f.label)}" ${value?'checked':''}></label>`;}
  else if(f.choices){input=`<select data-field="${esc(f.key)}" aria-label="${esc(f.label)}">${f.choices.map(v=>`<option value="${esc(JSON.stringify(v))}" ${JSON.stringify(v)===JSON.stringify(value)?'selected':''}>${esc(v||'None')}</option>`).join('')}</select>`;}
  else if(value!==null&&typeof value==='object')input=`<textarea data-field="${esc(f.key)}" spellcheck="false" aria-label="${esc(f.label)}">${esc(JSON.stringify(value,null,2))}</textarea>`;
  else input=`<input data-field="${esc(f.key)}" type="${typeof value==='number'?'number':'text'}" value="${esc(value)}" aria-label="${esc(f.label)}">`;
  return `<div class="profile-field ${changes.has(f.key)?'dirty':''}"><label>${esc(f.label)}<small>${esc(f.display)}</small></label>${input}</div>`;
}).join('')||'<div class="empty">No matching options.</div>';$('profileFields').innerHTML=`<div class="profile-section-heading"><h2>${esc(search?'Search results':category)}</h2><small>${fields.length} options</small></div>`+rows;}
function updateSave(){$('saveProfile').disabled=!changes.size;$('changeCount').textContent=changes.size?'('+changes.size+')':'';}
function setPage(next){if(next!=='overview')stopScreen('Live view paused — return to Overview to resume');page=next;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===next+'Page'));document.querySelectorAll('[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===next));$('pageName').textContent={overview:'Overview',logs:'Live logs',profiles:'Profiles',settings:'Settings',instances:'Instances'}[next];if(next==='settings'&&!$('settingsFrame').getAttribute('src'))$('settingsFrame').src='settings/';if(next==='profiles'&&token&&!profile)loadProfiles();if(next==='logs')showLogs();}
document.querySelectorAll('[data-page]').forEach(el=>el.onclick=()=>setPage(el.dataset.page));document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>setPage(el.dataset.go));
document.querySelectorAll('.brand[href="#overview"]').forEach(el=>el.onclick=event=>{event.preventDefault();setPage('overview');});
document.querySelectorAll('[data-period]').forEach(el=>el.onclick=()=>{period=el.dataset.period;document.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b===el));refreshStats();});
function clearScreenshot(){stopScreen('Live view stopped');frameBlob=null;$('downloadCapture').disabled=true;if(screenshotUrl)URL.revokeObjectURL(screenshotUrl);screenshotUrl=null;$('screenshot').removeAttribute('src');$('screenshot').hidden=true;$('screenStage').querySelector('.empty').hidden=false;$('captureTime').textContent='No screenshot captured';}
$('instanceSelect').onchange=()=>{clearScreenshot();renderInstance();refreshStats();};$('refresh').onclick=refresh;
$('instancesGrid').onclick=event=>{const button=event.target.closest('[data-open-instance]');if(button){$('instanceSelect').value=button.dataset.openInstance;$('instanceSelect').dispatchEvent(new Event('change'));setPage('overview');}};
$('instanceFleet').onclick=event=>{const button=event.target.closest('[data-instance]');if(button){$('instanceSelect').value=button.dataset.instance;$('instanceSelect').dispatchEvent(new Event('change'));}};
$('startMonitor').onclick=async()=>{try{await post('/api/bot/start');toast('Monitor started.');await refresh();}catch(e){toast(e.message);}};
$('stopMonitor').onclick=async()=>{try{await post('/api/bot/stop');toast('Monitor stopped.');await refresh();}catch(e){toast(e.message);}};
document.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{const instance=selected();if(!instance)return;button.disabled=true;try{const result=await post(`/api/instances/${encodeURIComponent(instance.id)}/actions`,{action:button.dataset.action});toast(result.output||'Action completed.');}catch(e){toast(e.message);}finally{renderInstance();}});
$('capture').onclick=takeScreenshot;$('captureQuick').onclick=takeScreenshot;$('liveToggle').onclick=toggleLive;$('liveQuick').onclick=toggleLive;
$('downloadCapture').onclick=()=>{if(!frameBlob)return;const link=document.createElement('a');const url=URL.createObjectURL(frameBlob);link.href=url;link.download='acbot-'+(selected()?.id||'emulator')+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('fullscreenPreview').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.screen-panel').requestFullscreen();}catch(error){toast('Fullscreen is not available in this browser.');}};
$('connectionButton').onclick=()=>{$('agentUrl').value=base;$('connectDialog').showModal();};$('closeConnect').onclick=()=>$('connectDialog').close();$('userMenu').onclick=()=>$('connectionButton').click();
$('connectForm').onsubmit=async event=>{event.preventDefault();$('loginError').textContent='';const button=event.submitter;button.disabled=true;try{const endpoint=new URL($('agentUrl').value);if(!['https:','http:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('Enter a valid HTTP or HTTPS agent address.');if(endpoint.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))throw Error('Use HTTPS for a remote PC agent.');const response=await fetch(endpoint.origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('agentPassword').value})});const result=await response.json();if(!response.ok)throw Error(result.error);clearScreenshot();base=endpoint.origin;token=result.token;sessionStorage.setItem('acbot.agent',base);sessionStorage.setItem('acbot.token',token);$('agentPassword').value='';$('settingsFrame').removeAttribute('src');$('connectDialog').close();await refresh();}catch(e){$('loginError').textContent=e.message;}finally{button.disabled=false;}};
$('disconnect').onclick=async()=>{try{await post('/api/logout');}catch{}token='';status=null;stats=null;profile=null;changes.clear();logLines=[];sessionStorage.removeItem('acbot.token');connected(false);drawMetrics();renderInstance();clearScreenshot();drawLogs();updateSave();$('settingsFrame').removeAttribute('src');$('activityList').textContent='Your monitor events will appear here.';$('botState').textContent='Monitor offline';$('botDot').classList.remove('on');$('connectDialog').close();toast('Disconnected.');};
$('logSelect').onchange=showLogs;$('logSearch').oninput=drawLogs;$('toggleLogs').onclick=()=>{paused=!paused;$('toggleLogs').innerHTML=icon(paused?'play':'pause')+(paused?' Resume updates':' Pause updates');$('liveBadge').textContent=paused?'Paused':'Updating every 2s';showLogs();};
$('profileInstance').onchange=loadProfiles;$('profileSelect').onchange=loadProfile;$('profileSearch').oninput=drawProfile;$('profileCategories').onclick=event=>{const button=event.target.closest('[data-category]');if(button){category=button.dataset.category;drawProfile();}};
$('profileFields').addEventListener('change',event=>{const key=event.target.dataset.field;if(!key)return;const field=profile.fields.find(f=>f.key===key);try{let value;if(typeof field.value==='boolean'){value=event.target.checked;event.target.closest('.boolean-control').querySelector('span').textContent=value?'Enabled':'Disabled';}else if(field.choices)value=JSON.parse(event.target.value);else if(field.value!==null&&typeof field.value==='object')value=JSON.parse(event.target.value);else if(typeof field.value==='number'){if(!event.target.value.trim())throw Error('Enter a number.');value=Number(event.target.value);if(!Number.isFinite(value))throw Error('Enter a valid number.');}else value=event.target.value;if(JSON.stringify(value)===JSON.stringify(field.value))changes.delete(key);else changes.set(key,value);event.target.closest('.profile-field').classList.toggle('dirty',changes.has(key));updateSave();}catch(error){toast(error.message);}});
$('saveProfile').onclick=async()=>{const button=$('saveProfile');button.disabled=true;try{const result=await post(`/api/instances/${encodeURIComponent($('profileInstance').value)}/profiles/${encodeURIComponent($('profileSelect').value)}/config`,{session:profile.session,changes:Object.fromEntries(changes)});profile=result;changes.clear();drawProfile();$('profileNotice').hidden=false;$('profileNotice').textContent='Changes saved. A backup was created. Restart ACBot below when you are ready to apply them.';$('restartInstance').hidden=false;toast('Profile saved.');}catch(e){toast(e.message);}finally{updateSave();}};
$('restartInstance').onclick=async()=>{const b=$('restartInstance');b.disabled=true;try{await post(`/api/instances/${encodeURIComponent($('profileInstance').value)}/restart`);toast('ACBot restarted.');}catch(e){toast(e.message);}finally{b.disabled=false;}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopScreen('Live view paused while this tab is hidden');});
window.addEventListener('pagehide',()=>stopScreen('Live view stopped'));
window.addEventListener('beforeunload',event=>{if(changes.size){event.preventDefault();event.returnValue='';}});
hydrateIcons();drawMetrics();renderInstance();$('agentUrl').placeholder=localAgentOrigin?'http://127.0.0.1:17942':'https://your-pc-agent-address';$('agentUrl').value=base;if(token&&base)refresh();else $('connectDialog').showModal();
function updateClock(){$('localClock').textContent=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}updateClock();setInterval(updateClock,30000);
setInterval(()=>{if(token&&!document.hidden){if(page==='overview'||page==='instances')refresh();if(page==='logs')showLogs();}},2000);
