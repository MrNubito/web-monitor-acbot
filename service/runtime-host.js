const path = require('path');
const fs = require('fs');
const dataDir = path.resolve(process.env.ACBOT_WEB_DATA || path.join(__dirname,'../data'));
fs.mkdirSync(dataDir,{recursive:true});
const handlers = new Map(), logs = [];
const { redact } = require('./agent/android-apk-monitor');
function recordLog(type,text) {
  for (const line of String(text).split(/\r?\n/).filter(Boolean)) logs.push({ type, text:redact(line), time:new Date().toISOString() });
  if(logs.length>500)logs.splice(0,logs.length-500);
}
const unavailable = () => { throw Error('Enter the local PC path in the browser settings.'); };
module.exports = {
  dataDir, handlers, logs, recordLog,
  app: { getPath:()=>dataDir, disableHardwareAcceleration(){}, commandLine:{appendSwitch(){}} },
  BrowserWindow: class { constructor(){throw Error('The web agent does not open desktop windows.');} },
  Menu:{setApplicationMenu(){}},
  dialog:{showErrorBox:(_title,text)=>recordLog('error',text),showOpenDialog:unavailable,showMessageBox:unavailable},
  ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
};
