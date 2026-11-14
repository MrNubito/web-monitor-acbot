const statisticImages={walls_upgraded:'resource-walls.png',donations_completed:'resource-donations.png',bb_attacks:'resource-attacks.png',bb_walls_upgraded:'resource-walls.png',obstacles_removed:'resource-obstacles.png',upgrades_done:'resource-upgrades.png',research_done:'resource-research.png',potions_used:'resource-research.png'};
export const miscStatistics=[
 ['Walls upgraded','walls_upgraded','wall'],['Donations completed','donations_completed','donate'],
 ['Builder Base attacks','bb_attacks','swords'],['Builder Base walls upgraded','bb_walls_upgraded','wall'],
 ['Obstacles removed','obstacles_removed','tree'],['Upgrades done','upgrades_done','hammer'],['Research done','research_done','flask'],['Potions used','potions_used','flask']
];
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?new Intl.NumberFormat('en-US').format(value):'—';
export function statisticsSummary(values={}){
 return '<section class="stats-detail stars-detail" aria-label="Attack stars"><h3>Stars</h3><div class="stars-grid">'+[0,1,2,3].map(stars=>'<div class="star-stat"><span class="star-rating" aria-label="'+stars+' star attacks">'+[1,2,3].map(i=>'<span class="'+(i<=stars?'earned':'')+'" aria-hidden="true">★</span>').join('')+'</span><strong>'+number(values['stars_'+stars])+'</strong></div>').join('')+'</div></section><section class="stats-detail" aria-label="Miscellaneous statistics"><h3>Misc stats</h3><div class="misc-stats-grid">'+miscStatistics.map(([label,key,symbol])=>'<div class="misc-stat"><span class="misc-icon misc-image"><img src="assets/'+statisticImages[key]+'" width="44" height="44" alt=""></span><div><strong>'+number(values[key])+'</strong><span>'+label+'</span></div></div>').join('')+'</div></section>';
}
