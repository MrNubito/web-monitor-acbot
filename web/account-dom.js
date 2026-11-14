const key=node=>node.nodeType===1?node.getAttribute('data-key'):null;
const same=(a,b)=>a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName);
function patch(node,next){
 if(node.nodeType===3||node.nodeType===8){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;return;}
 for(const attribute of [...node.attributes])if(!(node.tagName==='DETAILS'&&attribute.name==='open')&&!next.hasAttribute(attribute.name))node.removeAttribute(attribute.name);
 for(const attribute of [...next.attributes])if(!(node.tagName==='DETAILS'&&attribute.name==='open')&&node.getAttribute(attribute.name)!==attribute.value)node.setAttribute(attribute.name,attribute.value);
 children(node,next);
}
function children(parent,next){
 const original=[...parent.childNodes],used=new Set(),keyed=new Map(original.filter(n=>key(n)).map(n=>[key(n),n]));let cursor=parent.firstChild;
 for(const wanted of [...next.childNodes]){
  const id=key(wanted);let match=id?keyed.get(id):original.find(n=>!used.has(n)&&!key(n)&&same(n,wanted));
  if(match&&!same(match,wanted))match=null;
  if(match){used.add(match);if(match!==cursor)parent.insertBefore(match,cursor);patch(match,wanted);cursor=match.nextSibling;}
  else {const created=wanted.cloneNode(true);parent.insertBefore(created,cursor);}
 }
 for(const old of original)if(!used.has(old))old.remove();
}
function scrollParent(element){for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=parent.ownerDocument.defaultView?.getComputedStyle(parent);if(/auto|scroll/.test(style?.overflowY||'')&&parent.scrollHeight>parent.clientHeight)return parent;}return element.ownerDocument.scrollingElement;}
export function updateAccountDom(container,html){
 // Most checks return exactly the same counters. Do not touch the DOM in that case.
 if(container.__accountMarkup===html)return false;
 const document=container.ownerDocument,view=document.defaultView,scroller=scrollParent(container),beforeScroll=scroller?.scrollTop||0;
 let anchor;
 if(view)for(const node of container.querySelectorAll('[data-account-anchor]')){const rect=node.getBoundingClientRect();if(rect.width&&rect.height&&rect.top<view.innerHeight&&rect.bottom>0){anchor={node,top:rect.top};break;}}
 const template=document.createElement('template');template.innerHTML=html;children(container,template.content);container.__accountMarkup=html;
 if(anchor?.node.isConnected&&scroller){const delta=anchor.node.getBoundingClientRect().top-anchor.top;if(Math.abs(delta)>.5)scroller.scrollTop+=delta;}
 else if(scroller&&Math.abs(scroller.scrollTop-beforeScroll)>.5)scroller.scrollTop=beforeScroll;
 return true;
}
export function syncAccountOptions(select,items){
 const current=[...select.options].map(o=>[o.value,o.textContent]),next=items.map(i=>[String(i.id),String(i.label)]);
 if(JSON.stringify(current)===JSON.stringify(next))return;
 const previous=select.value,fragment=select.ownerDocument.createDocumentFragment();
 for(const [value,label]of next){const option=select.ownerDocument.createElement('option');option.value=value;option.textContent=label;fragment.append(option);}
 select.replaceChildren(fragment);if(next.some(([value])=>value===previous))select.value=previous;
}
