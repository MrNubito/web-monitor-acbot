const editor=require('./agent/profile-config');
const catalog=require('./agent/profile-slot-options.json');
const readonly=new Set(['TH_LEVEL','BH_LEVEL']);
function category(key){
 if(/^(HOME_PLACE_NEW_BUILDINGS|HOME_RUSH_TH_SKIP_BOAT)$/.test(key))return 'Upgrades/Research / Home';
 if(key==='BB_PLACE_NEW_BUILDINGS')return 'Upgrades/Research / Builder Base';
 if(/^(PASS_REWARDS_|SHOP_FREE_GIFT|MINI_EVENT_)/.test(key))return 'General / Rewards';
 if(/^(USE_POTIONS_BUY|END_BATTLE_ON_PERCENT|TARGET_PERCENT)/.test(key))return 'General';
 if(key==='HERO_RETAP_DISABLED')return 'Attack Army';
 return editor.category(key);
}
function describeProfile(config){
 const fields=Object.entries(config).filter(([key])=>editor.editable(key)&&!readonly.has(key)).map(([key,value])=>{
  const slots=editor.slotEditor(key,value);
  let control=null;
  if(slots)control={type:'slots',...slots,options:[...new Set(['',...(catalog[slots.group]||[]),...(slots.slots||[slots.current])])].map(value=>({value,label:editor.slotLabel(value)}))};
  if(key==='USE_POTIONS_SELECTED')control={type:'potions',options:[{value:'builder',label:'Builder Potion'},{value:'research',label:'Research Potion'}]};
  return {key,value,label:editor.optionName(key),category:category(key),display:editor.formattedValue(key,value,config),choices:editor.choices(key,value),control};
 });
 fields.sort((a,b)=>a.category.localeCompare(b.category)||a.label.localeCompare(b.label));
 return {fields,metadata:{townHall:Number.isInteger(config.TH_LEVEL)&&config.TH_LEVEL>0?config.TH_LEVEL:null,builderHall:Number.isInteger(config.BH_LEVEL)&&config.BH_LEVEL>0?config.BH_LEVEL:null}};
}
function validateChange(field,value){
 if(!field)throw Error('Invalid option.');
 if(field.control?.type==='slots'){
  const items=field.control.slots?typeof value==='string'?JSON.parse(value):value:[value];
  if(!Array.isArray(items)||(field.control.slots&&items.length!==field.control.slots.length)||items.some(v=>!field.control.options.some(o=>o.value===v)))throw Error('Choose a valid upgrade for every slot.');
 }
 if(field.control?.type==='potions'){
  const items=typeof value==='string'?JSON.parse(value):value;
  let original=field.value; if(typeof original==='string')original=JSON.parse(original);
  const allowed=new Set([...field.control.options.map(o=>o.value),...original]);
  if(!Array.isArray(items)||items.some(v=>!allowed.has(v)))throw Error('Choose a valid potion.');
 }
 return value;
}
module.exports={describeProfile,validateChange,readonly};
