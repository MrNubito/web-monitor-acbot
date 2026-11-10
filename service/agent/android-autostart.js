const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

// ADB screenshots and bundled templates are ordinary 8-bit RGB/RGBA PNGs.
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('Invalid Android screenshot.');
  let width, height, channels; const parts = [];
  for (let at = 8; at + 12 <= buffer.length;) {
    const size = buffer.readUInt32BE(at), type = buffer.toString('ascii', at + 4, at + 8);
    if (at + size + 12 > buffer.length) throw Error('Incomplete PNG.');
    const data = buffer.subarray(at + 8, at + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (data[8] !== 8 || !channels || data[12] !== 0 || width * height > 12000000) throw Error('Unsupported screenshot format.');
    } else if (type === 'IDAT') parts.push(data);
    at += size + 12;
  }
  if (!width || !height || !channels) throw Error('Missing screenshot header.');
  const stride = width * channels, raw = zlib.inflateSync(Buffer.concat(parts), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw Error('Invalid screenshot size.');
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a,b,c) => { const p = a+b-c, x = Math.abs(p-a), y = Math.abs(p-b), z = Math.abs(p-c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error('Invalid PNG filter.');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= channels ? pixels[i-channels] : 0, b = y ? pixels[i-stride] : 0, c = y && x >= channels ? pixels[i-stride-channels] : 0;
      pixels[i] = raw[y*(stride+1)+1+x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a+b)/2) : filter === 4 ? paeth(a,b,c) : 0);
    }
  }
  return { width, height, channels, pixels };
}
function findTemplate(image, template, region, scales = [1]) {
  const r = region || { left: 0, top: 0, right: image.width, bottom: image.height };
  let best = null;
  for (const scale of [...new Set(scales)]) {
    const width = Math.round(template.width * scale), height = Math.round(template.height * scale);
    if (width < 12 || height < 10) continue;
    const points = [];
    // Sample text/shape edges as well as background so plain purple/green areas cannot match a button.
    for (let y = 2; y < template.height-2; y += 3) for (let x = 2; x < template.width-2; x += 3) {
      const i = (y*template.width+x)*template.channels, j = i+template.channels*2;
      let contrast = 0; for (let c=0;c<3;c++) contrast += Math.abs(template.pixels[i+c]-template.pixels[j+c]);
      if (contrast > 65 || (x % 12 === 2 && y % 12 === 2)) points.push({ x: Math.round(x*scale), y: Math.round(y*scale), i });
    }
    if (points.length < 10) continue;
    const score = (x,y, threshold = 0.045) => {
      let total = 0;
      const limit = threshold * points.length * 3 * 255;
      for (const p of points) {
        const k = ((y+p.y)*image.width+x+p.x)*image.channels;
        for (let c=0;c<3;c++) total += Math.abs(image.pixels[k+c]-template.pixels[p.i+c]);
        if (total > limit) return 1;
      }
      return total / (points.length*3*255);
    };
    const left = Math.max(0, Math.floor(r.left)), top = Math.max(0, Math.floor(r.top));
    const right = Math.min(image.width, r.right)-width, bottom = Math.min(image.height,r.bottom)-height;
    for (let y=top;y<=bottom;y+=3) for (let x=left;x<=right;x+=3) {
      const value = score(x,y,0.20);
      if (value >= 0.20) continue;
      for (let yy=Math.max(top,y-2);yy<=Math.min(bottom,y+2);yy++) for (let xx=Math.max(left,x-2);xx<=Math.min(right,x+2);xx++) {
        const fine = score(xx,yy);
        if (fine < 0.045 && (!best || fine < best.score)) best = { x: xx+width/2, y: yy+height/2, score: fine, width, height };
        if (best?.score < 0.002) return best;
      }
    }
  }
  return best;
}
function overlayFrames(text, packageName) {
  return text.split(/(?=  Window #)/).filter(block => block.includes('package='+packageName+' ') && /ty=APPLICATION_OVERLAY/.test(block) && /isOnScreen=true/.test(block)).flatMap(block => {
    const m = block.match(/mFrame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    return m ? [{ left:+m[1],top:+m[2],right:+m[3],bottom:+m[4] }] : [];
  });
}
function runFile(executable, args, binary = false) {
  return new Promise((resolve,reject) => execFile(executable,args,{ windowsHide:true, timeout:15000, encoding:binary?null:'utf8',maxBuffer:16*1024*1024 },(error,stdout,stderr) => error ? reject(Error(binary ? 'Android screenshot failed.' : String(stderr || stdout || error.message).slice(0,300))) : resolve(stdout)));
}
function createAndroidAutostart({ adbPath, templateDir = path.join(__dirname,'app/assets/android-autostart'), run = runFile, now = Date.now, sleep = ms => new Promise(resolve=>setTimeout(resolve,ms)), onProgress = () => {} }) {
  const active = new Set(), templates = {};
  const report = (instance, message) => onProgress(instance.id, message);
  async function start(instance, { signal } = {}) {
    const key = instance.device;
    if (active.has(key)) throw Error('Android Autostart is already running for this device.');
    if (!/^[a-zA-Z0-9_.:[\]-]{1,150}$/.test(key || '') || !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(instance.packageName || '')) throw Error('Set a valid ADB device and Android package first.');
    active.add(key);
    const check = () => { if (signal?.aborted) throw Error('Android Autostart cancelled.'); };
    const adb = async (args,binary) => { check(); return run(adbPath,['-s',key,...args],binary); };
    const tap = async p => { check(); await adb(['shell','input','tap',String(Math.round(p.x)),String(Math.round(p.y))]); };
    const connected = async () => {
      if (key.includes(':')) await run(adbPath,['connect',key]).catch(()=>{});
      return (await adb(['shell','getprop','sys.boot_completed']).catch(()=>'' )).trim() === '1';
    };
    try {
      check(); report(instance,'Waiting for Android');
      const readyAtStart = await connected();
      check();
      if (!readyAtStart) {
        const launcher = String(instance.emulatorPath || '');
        if (!launcher || !fs.existsSync(launcher)) throw Error('Android is offline. Choose the MuMu CLI or LDPlayer console executable for this instance.');
        if (!/^\d{1,3}$/.test(String(instance.emulatorIndex ?? ''))) throw Error('Set the emulator instance index.');
        const name = path.basename(launcher).toLowerCase();
        const args = /^(mumu-cli|mumumanager)\.exe$/.test(name) ? ['control','-v',String(instance.emulatorIndex),'launch'] : /^(ldconsole|dnconsole)\.exe$/.test(name) ? ['launch','--index',String(instance.emulatorIndex)] : null;
        if (!args) throw Error('Select mumu-cli.exe, MuMuManager.exe, ldconsole.exe or dnconsole.exe.');
        report(instance,'Opening emulator'); await run(launcher,args);
        const deadline = now()+180000; let ready=false;
        while (now()<deadline) { check(); if (await connected()) {ready=true;break;} await sleep(2000); }
        if (!ready) throw Error('Android did not finish booting within 3 minutes.');
      }
      for (const name of ['authenticate','launch','start','running']) templates[name] ||= decodePng(fs.readFileSync(path.join(templateDir,name+'.png')));
      let opened=false, authenticated=false, launched=false, started=false, bubbleClicks=0, lastBubble=0;
      const deadline = now()+150000;
      while (now()<deadline) {
        check();
        const windows = await adb(['shell','dumpsys','window','windows']);
        const frames = overlayFrames(windows,instance.packageName);
        const screenshot = decodePng(await adb(['exec-out','screencap','-p'],true));
        const scales = [1, screenshot.width/1600, 2/3,0.8,1.25,1.5,2];
        const menus = frames.filter(f=>f.right-f.left > 160 && Math.abs((f.right-f.left)-(f.bottom-f.top))<15);
        for (const frame of menus) {
          if (findTemplate(screenshot,templates.running,frame,scales)) {
            report(instance,started?'Bot started successfully':'Bot is already running');
            return { ok:true, alreadyRunning:!started };
          }
          const button = findTemplate(screenshot,templates.start,frame,scales);
          if (button && !started) { report(instance,'Pressing Start'); await tap(button); started=true; break; }
        }
        const bubble = frames.find(f=>f.right-f.left>=35 && f.right-f.left<=180 && Math.abs((f.right-f.left)-(f.bottom-f.top))<12);
        if (bubble) {
          if (!menus.length && now()-lastBubble>4000 && bubbleClicks<4) {
            const left=Math.max(0,bubble.left), top=Math.max(0,bubble.top), right=Math.min(screenshot.width,bubble.right),bottom=Math.min(screenshot.height,bubble.bottom);
            if (right>left && bottom>top) { report(instance,'Opening floating bot menu'); await tap({x:(left+right)/2,y:(top+bottom)/2}); lastBubble=now();bubbleClicks++; }
          }
          await sleep(1200); continue;
        }
        if (started) { report(instance,'Verifying Running state'); await sleep(1200); continue; }
        if (!opened) {
          report(instance,'Opening ACBot');
          const resolved = await adb(['shell','cmd','package','resolve-activity','--brief',instance.packageName]);
          const component = resolved.split(/\r?\n/).map(v=>v.trim()).find(v=>v.startsWith(instance.packageName+'/'));
          if (!component || !/^[\w.$]+\/[\w.$]+$/.test(component)) throw Error('The configured ACBot APK is not installed or has no launcher activity.');
          await adb(['shell','am','start','-n',component]); opened=true; await sleep(1500);continue;
        }
        // Match only while ACBot owns the main window. Never click permission dialogs or other apps.
        if (windows.split(/\r?\n/).some(line => /topApp=ActivityRecord|mObscuringWindow=|mCurrentFocus=/.test(line) && line.includes(instance.packageName+'/'))) {
          const launch = findTemplate(screenshot,templates.launch,null,scales);
          if (launch && !launched) { report(instance,'Launching game + bot');await tap(launch);launched=true;await sleep(2000);continue; }
          const auth = findTemplate(screenshot,templates.authenticate,null,scales);
          if (auth && !authenticated) { report(instance,'Authenticating with the saved key');await tap(auth);authenticated=true;await sleep(2000);continue; }
        }
        await sleep(1500);
      }
      throw Error(started ? 'Start was pressed, but Running could not be confirmed. Check the APK.' : 'ACBot did not reach Start. Check the saved key, permissions and APK screen.');
    } finally { active.delete(key); }
  }
  return { start, isRunning: device=>active.has(device) };
}
module.exports = { decodePng, findTemplate, overlayFrames, createAndroidAutostart };
