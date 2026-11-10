const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function structuredControl(field,value){
 const control=field.control;if(!control)return null;
 if(control.type==='slots'){
  const items=control.slots?(typeof value==='string'?JSON.parse(value):value):[value];
  return '<div class="slot-controls">'+items.map((item,index)=>'<label><span>'+ (control.slots?'Slot '+(index+1):'Target')+'</span><select data-structured="slots" data-key="'+esc(field.key)+'" data-index="'+index+'" aria-label="'+esc(field.label)+' '+(index+1)+'">'+control.options.map(o=>'<option value="'+esc(o.value)+'" '+(o.value===item?'selected':'')+'>'+esc(o.label)+'</option>').join('')+'</select></label>').join('')+'</div>';
 }
 if(control.type==='potions'){
  const items=typeof value==='string'?JSON.parse(value):value;
  return '<div class="potion-controls">'+control.options.map(o=>'<label><input type="checkbox" data-structured="potions" data-key="'+esc(field.key)+'" value="'+esc(o.value)+'" '+(items.includes(o.value)?'checked':'')+'>'+esc(o.label)+'</label>').join('')+'</div>';
 }
 return null;
}
export function structuredValue(field,current,index,value,checked){
 let next=typeof current==='string'&&field.control.type==='potions'||typeof current==='string'&&field.control.slots?JSON.parse(current):current;
 if(field.control.type==='slots'){
  if(!field.control.slots)return value;
  next=[...next];next[index]=value;
 }else {next=next.filter(item=>item!==value);if(checked)next.push(value);}
 return typeof current==='string'?JSON.stringify(next):next;
}
