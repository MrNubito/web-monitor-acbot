const keys=['gold_gained','elixir_gained','dark_gained'];
const colors=['#bc48f5','#db88ff','#805098'];
const number=value=>value==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(value);
const time=value=>new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
export function createPerformanceHistory(limit=90){
  const histories=new Map();
  return {
    record(key,stats,at=Date.now()){
      const values=keys.map(k=>stats[k]==null?null:Number(stats[k]));
      if(values.every(v=>v==null||!Number.isFinite(v)))return [];
      let rows=histories.get(key)||[];
      const previous=rows.at(-1);
      // A reset in cumulative counters indicates a new session, not negative progress.
      if(previous&&values.some((v,i)=>v!=null&&Number.isFinite(v)&&previous.values[i]!=null&&v<previous.values[i]))rows=[];
      if(rows.length&&at-rows.at(-1).at<1000)return rows;
      rows.push({at,values:values.map(v=>Number.isFinite(v)?v:null)});
      if(rows.length>limit)rows.splice(0,rows.length-limit);
      histories.set(key,rows);if(histories.size>30)histories.delete(histories.keys().next().value);
      return rows;
    }
  };
}
export function performanceSvg(rows){
  if(!rows.length)return '<div class="empty compact">Waiting for performance data.</div>';
  const width=520,height=118,left=38,right=505,top=10,bottom=96;
  const maximum=Math.max(1,...rows.flatMap(row=>row.values.filter(v=>v!=null)))*1.12;
  const start=rows[0].at,end=rows.at(-1).at;
  const x=at=>left+(end===start?0:(at-start)/(end-start))*(right-left);
  const y=v=>bottom-Math.max(0,v)/maximum*(bottom-top);
  const ticks=[0,.5,1].map(f=>{const yy=bottom-f*(bottom-top);return `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#40294f" stroke-width=".7"/><text x="${left-7}" y="${yy+3}" text-anchor="end" fill="#9a7bac" font-size="8">${number(maximum*f)}</text>`;}).join('');
  const series=keys.map((key,i)=>{
    const points=rows.filter(row=>row.values[i]!=null).map(row=>[x(row.at),y(row.values[i])]);if(!points.length)return '';
    const path=points.map(([xx,yy],j)=>(j?'L':'M')+xx.toFixed(2)+' '+yy.toFixed(2)).join(' ');
    const last=points.at(-1);const fill=i===0&&points.length>1?`<path d="${path} L${last[0]} ${bottom} L${points[0][0]} ${bottom}Z" fill="url(#performanceArea)"/>`:'';
    return fill+`<path d="${path}" fill="none" stroke="${colors[i]}" stroke-width="${i===0?2:1.4}" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${colors[i]}" stroke="#f4ccff" stroke-width=".5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Resource totals observed since this page was opened"><defs><linearGradient id="performanceArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#9d23db" stop-opacity=".45"/><stop offset="1" stop-color="#9d23db" stop-opacity="0"/></linearGradient></defs>${ticks}${series}<text x="${left}" y="113" fill="#886695" font-size="7">${time(start)}</text>${rows.length>1?`<text x="${right}" y="113" text-anchor="end" fill="#886695" font-size="7">${time(end)}</text>`:''}</svg>`;
}
