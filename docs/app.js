(function(){
"use strict";
/* Trip planner: day timelines with a day-at-a-glance card (forecast, totals, now/next),
   a Google map that shows whatever stop you open, and the prep tab (bookings + checklists).
   All trip content comes from trip.json (the chat backend reads the same file). */
var CFG=window.TRIP_CONFIG||{};
var wide=window.matchMedia?matchMedia("(min-width: 901px)"):{matches:true};
var KCOL={paddle:"#2C6688",hike:"#2F7A4E",visit:"#2F5A45",food:"#C2461F",stay:"#5A6A62",meet:"#5A6A62",start:"#5A6A62",drive:"#5E6B65"};
var OUTDOORS={hike:1,paddle:1,visit:1};
var DAYKEYS=["sat","sun"];

/* ---------- small helpers ---------- */
var $=function(id){return document.getElementById(id);};
function mins(s){var p=s.split(":");return +p[0]*60+ +p[1];}
function fmt(m){m=Math.round(m);var h=Math.floor(m/60),mm=m%60;return (h%12||12)+":"+(mm<10?"0":"")+mm+" "+(h>=12?"PM":"AM");}
function fmtS(m){return fmt(m).replace(" AM","a").replace(" PM","p");}
function hm(d){var h=Math.floor(d/60),m=d%60;return ((h?h+" h ":"")+(m?m+" min":"")).trim()||"0 min";}
function dur(a,b){return hm(mins(b)-mins(a));}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
// inline markup used in trip.json: `code`, **bold** and [text](https://url)
function inline(s){return esc(s).replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');}
function store(k,v){try{if(v===undefined)return JSON.parse(localStorage.getItem(k));localStorage.setItem(k,JSON.stringify(v));}catch(e){return null;}}
function decode(s){var pts=[],i=0,lat=0,lng=0;while(i<s.length){for(var n=0;n<2;n++){var sh=0,r=0,b;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5;}while(b>=32);var v=r&1?~(r>>1):r>>1;if(n)lng+=v;else lat+=v;}pts.push([lat/1e5,lng/1e5]);}return pts;}
function km(a,b){var k=Math.cos((a[0]+b[0])/2*Math.PI/180);return Math.hypot((a[0]-b[0])*111.2,(a[1]-b[1])*111.32*k);}
function along(pts,f){if(pts.length<2)return pts[0];var seg=[],tot=0;for(var i=1;i<pts.length;i++){var d=km(pts[i-1],pts[i]);seg.push(d);tot+=d;}
  var t=Math.max(0,Math.min(1,f))*tot;for(var j=0;j<seg.length;j++){if(t<=seg[j]||j===seg.length-1){var u=seg[j]?Math.min(1,t/seg[j]):0,a=pts[j],b=pts[j+1];return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];}t-=seg[j];}return pts[pts.length-1];}
function torontoNow(){var p={};new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).forEach(function(x){p[x.type]=x.value;});
  return {date:p.year+"-"+p.month+"-"+p.day,mins:+p.hour*60+ +p.minute};}
function daysBetween(a,b){return Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/864e5);}
var ICON={
  maps:'<svg viewBox="0 0 20 20"><path d="M10 18s-5.5-5.2-5.5-9.5a5.5 5.5 0 0 1 11 0C15.5 12.8 10 18 10 18z"/><circle cx="10" cy="8.5" r="2"/></svg>',
  dir:'<svg viewBox="0 0 20 20"><path d="M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8"/></svg>',
  ask:'<svg viewBox="0 0 20 20"><path d="M4 4.5h12v8H9l-4 3v-3H4z"/></svg>',
  phone:'<svg viewBox="0 0 20 20"><path d="M5 3h3l1.5 4-2 1.2a9 9 0 0 0 4.3 4.3L13 10.5l4 1.5v3a2 2 0 0 1-2 2A12 12 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
  check:'<svg viewBox="0 0 20 20"><path d="M4 10.5l4 4 8-9"/></svg>',
  car:'<svg viewBox="0 0 20 20"><path d="M4 13V9.5L5.6 5h8.8L16 9.5V13M4 13h12M4 13v2M16 13v2"/></svg>',
  chev:'<svg class="chev" viewBox="0 0 20 20"><path d="M5 8l5 5 5-5"/></svg>'
};
var WX={sun:'<svg viewBox="0 0 48 48"><g class="sun"><circle cx="24" cy="24" r="8"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11 11l3.5 3.5M33.5 33.5 37 37M11 37l3.5-3.5M33.5 14.5 37 11"/></g></svg>',
  part:'<svg viewBox="0 0 48 48"><g class="sun"><circle cx="18" cy="17" r="6"/><path d="M18 5v3M6 17h3M9.5 8.5l2 2M26.5 8.5l-2 2"/></g><path d="M16 38h20a7 7 0 0 0 0-14 10 10 0 0 0-19 3 5.5 5.5 0 0 0-1 11z"/></svg>',
  cloud:'<svg viewBox="0 0 48 48"><path d="M13 36h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z"/></svg>',
  rain:'<svg viewBox="0 0 48 48"><path d="M13 30h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z"/><path d="M17 35l-2 5M25 35l-2 5M33 35l-2 5"/></svg>',
  snow:'<svg viewBox="0 0 48 48"><path d="M13 30h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z"/><path d="M17 37h.01M24 40h.01M31 37h.01"/></svg>',
  fog:'<svg viewBox="0 0 48 48"><path d="M10 20h28M6 27h36M10 34h28"/></svg>',
  storm:'<svg viewBox="0 0 48 48"><path d="M13 30h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z"/><path d="M25 32l-4 6h6l-4 6"/></svg>'};
function wmo(c){if(c===0)return ["Clear","sun"];if(c<=2)return ["Partly cloudy","part"];if(c===3)return ["Overcast","cloud"];if(c<=48)return ["Fog","fog"];
  if(c<=57)return ["Drizzle","rain"];if(c<=67)return ["Rain","rain"];if(c<=77)return ["Snow","snow"];if(c<=82)return ["Showers","rain"];if(c<=86)return ["Snow showers","snow"];return ["Thunderstorms","storm"];}

/* ---------- state ---------- */
var T,DAYS,N={},GPID={};
var state={view:"sat",sel:null},weather={};

function gPlace(id){var ll=N[id];var u="https://www.google.com/maps/search/?api=1&query="+ll[0]+"%2C"+ll[1];if(GPID[id])u+="&query_place_id="+GPID[id];return u;}
function gRoute(ids){var c=ids.map(function(id){return N[id][0]+","+N[id][1];});return "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin="+encodeURIComponent(c[0])+"&destination="+encodeURIComponent(c[c.length-1])+(c.length>2?"&waypoints="+encodeURIComponent(c.slice(1,-1).join("|")):"");}
function LL(x){return typeof x==="string"?N[x]:x;}
function day(){return DAYS[state.view]||DAYS.sat;}
function liveDay(){var now=torontoNow().date;if(now===T.dates.start)return "sat";if(now===T.dates.end)return "sun";return null;}
function dateOf(k){return k==="sat"?T.dates.start:T.dates.end;}

function boot(trip){
  T=trip;DAYS=trip.days;
  Object.keys(T.places).forEach(function(k){N[k]=T.places[k].ll;if(T.places[k].gid)GPID[k]=T.places[k].gid;});
  DAYKEYS.forEach(function(k){var n=0;DAYS[k].segs.forEach(function(s,i){s.i=i;if(s.t==="stop")s.num=++n;
    s.pts=s.geom?decode(s.geom):(s.t==="drive"?s.path.map(LL):null);});});
  renderHeader();renderPrep();
  var v=store("alg-view");
  setView(liveDay()||(v==="sun"||v==="prep"?v:"sat"));
  loadMap();loadWeather();
  setInterval(function(){if(liveDay()===state.view)renderGlance();},60000);
  window.tripApp={context:function(){var D=day(),s=state.sel!=null?D.segs[state.sel]:null;
    return {day:state.view==="prep"?"Prep tab":D.title,looking_at:state.view==="prep"?"bookings and packing checklist":(s?(s.t==="drive"?"Driving "+s.label:s.num+". "+s.name+" ("+fmt(mins(s.start))+")"):"the whole day")};},
    label:function(){var s=state.view!=="prep"&&state.sel!=null?day().segs[state.sel]:null;
      return state.view==="prep"?"Prep":s?(s.t==="drive"?s.label:s.name):day().title.split(",")[0];}};
  document.dispatchEvent(new CustomEvent("trip:view"));
}

/* ---------- header ---------- */
function nextBooking(){var today=torontoNow().date,done=store("alg-booked")||{};
  return T.bookings.filter(function(b){return b.opens&&!done[b.id]&&b.opens.slice(0,10)>=today;}).sort(function(a,b){return a.opens<b.opens?-1:1;})[0];}
function renderHeader(){
  document.title=T.title.replace(" Thanksgiving","");
  $("eyebrow").textContent=T.eyebrow;$("title").textContent=T.title;
  $("lede").textContent=T.lede.replace(/ Drag the time slider.*$/,"");
  var today=torontoNow().date,d=daysBetween(today,T.dates.start),chips=[];
  if(d>1)chips.push('<span class="chip count">In '+d+' days</span>');
  else if(d===1)chips.push('<span class="chip count">Tomorrow</span>');
  else if(today<=T.dates.end)chips.push('<span class="chip count">Happening now</span>');
  var nb=nextBooking();
  if(nb){var n=daysBetween(today,nb.opens.slice(0,10));
    chips.push('<button class="chip due" data-booking="'+esc(nb.id)+'">Book the '+esc(nb.what)+' '+(n===0?"today":n===1?"tomorrow":"in "+n+" days")+" at "+fmt(mins(nb.opens.slice(11,16)))+" →</button>");}
  T.conditions.forEach(function(c){chips.push('<span class="chip'+(/closed/i.test(c[0])?" warn":"")+'"><b>'+esc(c[0])+':</b> '+esc(c[1])+'</span>');});
  $("chips").innerHTML=chips.join("");
  var due=$("chips").querySelector(".due");if(due)due.addEventListener("click",function(){openBooking(due.dataset.booking);});
}

/* ---------- prep ---------- */
var M=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function renderPrep(){
  var today=torontoNow().date,done=store("alg-booked")||{},nb=nextBooking();
  $("bookings").innerHTML=T.bookings.map(function(b){
    var badge,due="",isDone=!!done[b.id];
    if(b.opens){var dt=b.opens.slice(0,10),n=daysBetween(today,dt);badge="<small>"+M[+dt.slice(5,7)-1]+"</small><b>"+(+dt.slice(8,10))+"</b>";
      var at=fmt(mins(b.opens.slice(11,16)));
      due=n>1?"Opens in "+n+" days, "+at:n===1?"Opens tomorrow, "+at:n===0?"Opens today, "+at:"Open now";}
    else{badge="<b>!</b><small>"+esc(b.when.replace("Book ",""))+"</small>";due=b.when;}
    if(isDone){badge=ICON.check.replace("<svg",'<svg style="width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"');due="Booked";}
    var val=function(k){var f=(b.select||[]).concat(b.key||[]).filter(function(x){return x[0]===k;})[0];return f&&f[1];};
    var h='<details class="booking'+(b.hot?" hot":"")+(isDone?" done":"")+'" id="bk-'+esc(b.id)+'"'+(nb&&nb.id===b.id?" open":"")+'>';
    h+='<summary><span class="b-date">'+badge+'</span><span class="b-title">'+esc(b.what)+'</span>';
    h+='<span class="b-line"><span class="due">'+esc(due)+'</span>'+[(b.site&&b.site.park)||val("Store")||val("Where"),b.for.split(",")[0],val("Cost")].filter(Boolean).map(function(x){return " · "+esc(x);}).join("")+'</span>';
    h+='<svg class="b-chev" viewBox="0 0 20 20"><path d="M5 8l5 5 5-5"/></svg></summary><div class="b-body">';
    // a small replica of the booking site with the exact choices highlighted
    if(b.site)h+=siteMock(b.site)+(b.then?'<p class="b-then">'+inline(b.then)+"</p>":"");
    // what to pick, in the order the booking site asks for it
    if(b.select&&b.select.length)h+='<ol class="select">'+b.select.map(function(x){return '<li><small>'+esc(x[0])+'</small><b>'+esc(x[1])+'</b></li>';}).join("")+"</ol>";
    if(b.key&&b.key.length)h+='<dl class="keyfacts">'+b.key.map(function(f){return "<div><dt>"+esc(f[0])+"</dt><dd>"+esc(f[1])+"</dd></div>";}).join("")+"</dl>";
    if(b.tip)h+='<p class="b-tip">'+inline(b.tip)+"</p>";
    var acts=[],link=(b.links||[])[0];
    if(link)acts.push('<a class="pill primary" target="_blank" rel="noopener" href="'+esc(link[1])+'">'+ICON.dir+"Open "+esc(link[0].replace(/ page$/,""))+"</a>");
    var tel=(b.select||[]).concat(b.key||[]).map(function(x){return x[1];}).concat(b.steps||[],b.tips||[]).join(" ").match(/(1-8\d\d-\d{3}-\d{4})/);
    if(tel)acts.push('<a class="pill" href="tel:'+tel[1].replace(/-/g,"")+'">'+ICON.phone+"Call</a>");
    acts.push('<button class="pill'+(isDone?" on":"")+'" type="button" data-done="'+esc(b.id)+'">'+ICON.check+(isDone?"Booked":"Mark booked")+"</button>");
    acts.push('<button class="pill ask" type="button" data-ask="'+esc(b.id)+'">'+ICON.ask+"Ask</button>");
    h+='<div class="actions">'+acts.join("")+"</div>";
    if(b.steps&&b.steps.length)h+='<details class="allsteps"><summary>All steps</summary><ol class="steps">'+b.steps.map(function(s){return "<li><span>"+inline(s)+"</span></li>";}).join("")+"</ol></details>";
    h+="</div></details>";
    return h;
  }).join("");
  var nDone=T.bookings.filter(function(b){return done[b.id];}).length;
  $("bookedCount").textContent=nDone+" of "+T.bookings.length+" booked · ticks are saved on this device";

  var checked=store("alg-check2")||{};
  $("prepLists").innerHTML=T.prep.map(function(card,ci){
    var items=card.items.map(function(it,ii){var id=ci+"-"+ii;
      var h='<li class="citem"><div class="citem-row"><label class="check"><input type="checkbox" data-id="'+id+'"'+(checked[id]?" checked":"")+'><span>'+inline(it.t)+'</span></label>';
      if(it.more)h+='<button class="more-btn" type="button" aria-expanded="false" aria-label="More about this">'+ICON.chev.replace(' class="chev"',"")+"</button>";
      h+="</div>";if(it.more)h+='<p class="more" hidden>'+inline(it.more)+"</p>";
      return h+"</li>";}).join("");
    return '<div class="list-head"><h2>'+esc(card.title)+'</h2><small data-count="'+ci+'"></small></div><ul class="checklist">'+items+'</ul>';
  }).join("");
  $("footnote").textContent=T.footnote;
  $("sources").innerHTML="Sources: "+T.sources.concat([["Ontario Parks day-use FAQ","https://www.ontarioparks.ca/dayuse/faq"],["Algonquin day-use fees","https://www.algonquinpark.on.ca/visit/general_park_info/fees-day-use.php"],["Forecast: Open-Meteo","https://open-meteo.com/"]]).map(function(s){return '<a href="'+esc(s[1])+'" target="_blank" rel="noopener">'+esc(s[0])+'</a>';}).join(" · ");
  countPrep();
}
function siteMock(x){
  var h='<div class="site"><div class="site-bar"><span></span><span></span><span></span>reservations.ontarioparks.ca</div><div class="site-body">';
  h+='<div class="site-step"><span class="site-n">1</span><div class="site-main">';
  h+='<div class="site-tabs"><span>Campsite</span><span class="on">'+esc(x.tab)+'</span><span>Backcountry</span><span>Roofed Accommodations</span></div>';
  h+='<div class="site-radio"><span class="rb"></span>'+esc(x.type)+'</div>';
  h+='<div class="site-fields"><div><small>Park</small><span class="fld pick">'+esc(x.park)+'</span></div><div><small>Arrival</small><span class="fld pick">'+esc(x.arrival)+'</span></div><span class="site-btn">Search</span></div>';
  if(x.warn)h+='<p class="site-warn">'+esc(x.warn)+"</p>";
  h+="</div></div>";
  h+='<div class="site-step"><span class="site-n">2</span><div class="site-main"><div class="site-scroll"><table class="site-grid"><thead><tr><th>Activity</th>'+
    x.dates.map(function(d,i){return '<th'+(i===x.pickDate?' class="col"':"")+">"+esc(d)+"</th>";}).join("")+"</tr></thead><tbody>"+
    x.rows.map(function(r,ri){return '<tr'+(ri===x.pickRow?' class="row"':"")+"><th>"+esc(r)+"</th>"+x.dates.map(function(_,di){
      return ri===x.pickRow&&di===x.pickDate?'<td class="hit"><span>Click</span></td>':"<td></td>";}).join("")+"</tr>";}).join("")+
    "</tbody></table></div></div></div>";
  return h+"</div></div>";
}
function countPrep(){var all=0,on=0;
  T.prep.forEach(function(card,ci){var c=0;card.items.forEach(function(_,ii){var el=document.querySelector('[data-id="'+ci+"-"+ii+'"]');if(el&&el.checked)c++;});
    all+=card.items.length;on+=c;var lab=document.querySelector('[data-count="'+ci+'"]');if(lab)lab.textContent=c+" of "+card.items.length;});
  var done=store("alg-booked")||{},b=T.bookings.filter(function(x){return done[x.id];}).length;
  $("prepCount").textContent=(b+on)+"/"+(T.bookings.length+all);}
$("prepView").addEventListener("change",function(e){var id=e.target.dataset&&e.target.dataset.id;if(!id)return;var d=store("alg-check2")||{};d[id]=e.target.checked;store("alg-check2",d);countPrep();});
$("prepView").addEventListener("click",function(e){
  var mb=e.target.closest(".more-btn");
  if(mb){var p=mb.closest(".citem").querySelector(".more"),on=mb.getAttribute("aria-expanded")!=="true";mb.setAttribute("aria-expanded",on);p.hidden=!on;return;}
  var dn=e.target.closest("[data-done]");
  if(dn){var d=store("alg-booked")||{},id=dn.dataset.done;d[id]=!d[id];store("alg-booked",d);renderPrep();renderHeader();var el=$("bk-"+id);if(el)el.open=true;return;}
  var ak=e.target.closest("[data-ask]");
  if(ak){var b=T.bookings.filter(function(x){return x.id===ak.dataset.ask;})[0];if(b&&window.tripChat)window.tripChat.ask("Walk me through booking the "+b.what+". Anything I should watch out for?");}
});
function openBooking(id){setView("prep");T.bookings.forEach(function(b){var el=$("bk-"+b.id);if(el)el.open=b.id===id;});
  var el=$("bk-"+id);if(el)el.scrollIntoView({block:"start",behavior:"smooth"});}

/* ---------- views & timeline ---------- */
function setView(v){
  state.view=v;store("alg-view",v);state.sel=null;
  document.querySelectorAll(".seg-btn").forEach(function(b){b.setAttribute("aria-selected",b.dataset.view===v?"true":"false");});
  $("prepView").hidden=v!=="prep";$("dayView").hidden=v==="prep";
  if(v!=="prep"){
    var D=day();$("dayTitle").textContent=D.title;
    $("dayRoute").href=gRoute(T.dayRoutes[v]);
    renderGlance();renderRows();
    var cur=liveDay()===v?nowSeg():null;
    if(cur){select(cur.i,false);return;}
  }else $("dayRoute").href=gRoute(T.dayRoutes.sat.concat(T.dayRoutes.sun.slice(1)));
  drawDay();fitDay();
}
document.querySelectorAll(".seg-btn").forEach(function(b){b.addEventListener("click",function(){setView(b.dataset.view);});});

function nowSeg(){var t=torontoNow().mins,segs=day().segs,best=null;
  for(var i=0;i<segs.length;i++){var s=segs[i];if(t>=mins(s.start)&&t<=mins(s.end)){if(s.t==="stop"&&s.start!==s.end)return s;best=best||s;}}
  if(best)return best;if(t<mins(segs[0].start))return segs[0];return segs[segs.length-1];}

function renderRows(){
  var D=day(),ol=$("rows"),cur=liveDay()===state.view?nowSeg():null;ol.innerHTML="";
  D.segs.forEach(function(s){
    var li=document.createElement("li");li.dataset.i=s.i;if(cur&&cur.i===s.i)li.classList.add("now");
    var b=document.createElement("button");b.className="row"+(s.t==="drive"?" drive":"");b.setAttribute("aria-expanded","false");
    if(s.t==="drive"){b.innerHTML='<span class="t"></span><span class="num">'+ICON.car+'</span><span class="n"></span>'+ICON.chev;b.querySelector(".n").textContent=dur(s.start,s.end)+" · "+s.label;}
    else{b.style.setProperty("--k",KCOL[s.kind]);
      b.innerHTML='<span class="t"></span><span class="num"></span><span class="n"></span>'+ICON.chev+'<span class="s"></span>';
      b.querySelector(".t").textContent=fmtS(mins(s.start));b.querySelector(".num").textContent=s.num;b.querySelector(".n").textContent=s.name;
      if(cur&&cur.i===s.i)b.querySelector(".n").insertAdjacentHTML("beforeend",'<span class="now-tag">NOW</span>');
      b.querySelector(".s").textContent=[s.km?"km "+s.km:"",s.start===s.end?"":dur(s.start,s.end),T.kinds[s.kind]].filter(Boolean).join(" · ");}
    b.addEventListener("click",function(){if(state.sel===s.i){state.sel=null;paintOpen();markSel();fitDay();}else select(s.i,true);});
    li.appendChild(b);ol.appendChild(li);
  });
}
function select(i,scroll){state.sel=i;paintOpen();var s=day().segs[i];
  markSel();frame(s);caption();
  if(scroll===false){var li=document.querySelector('#rows>li[data-i="'+i+'"]');if(li)li.scrollIntoView({block:"center"});}}
function paintOpen(){
  document.querySelectorAll("#rows>li").forEach(function(li){var i=+li.dataset.i,on=i===state.sel;
    li.classList.toggle("open",on);li.querySelector(".row").setAttribute("aria-expanded",on);
    var d=li.querySelector(".detail");if(on&&!d){li.appendChild(detail(day().segs[i]));}else if(!on&&d)d.remove();});
  document.dispatchEvent(new CustomEvent("trip:view"));
}
function detail(s){
  var d=document.createElement("div");d.className="detail";var kind=s.t==="drive"?"drive":s.kind;
  var h='<span class="kind" style="--k:'+KCOL[kind]+'">'+esc(T.kinds[kind])+(s.km?" · km "+esc(s.km):"")+" · "+esc(s.start===s.end?fmt(mins(s.start)):fmt(mins(s.start))+" – "+fmt(mins(s.end)))+'</span>';
  if(s.facts&&s.facts.length)h+='<dl class="facts">'+s.facts.map(function(f){return "<div><dt>"+esc(f[0])+"</dt><dd>"+esc(f[1])+"</dd></div>";}).join("")+"</dl>";
  var body=s.body||s.note||(s.t==="drive"?"Driving between stops.":"");if(body)h+='<p class="body">'+esc(body)+"</p>";
  if(s.tips&&s.tips.length)h+='<ul class="tips">'+s.tips.map(function(t){return "<li>"+esc(t)+"</li>";}).join("")+"</ul>";
  var acts=[];
  if(s.t==="stop"&&s.place!=="markham")acts.push('<a class="pill" target="_blank" rel="noopener" href="'+esc(gPlace(s.place))+'">'+ICON.maps+"Open in Google Maps</a>");
  if(s.t==="drive"){var ends=[s.path[0],s.path[s.path.length-1]].filter(function(x){return typeof x==="string";});if(ends.length===2)acts.push('<a class="pill" target="_blank" rel="noopener" href="'+esc(gRoute(ends))+'">'+ICON.dir+"Directions</a>");}
  acts.push('<button class="pill ask" type="button">'+ICON.ask+"Ask about this</button>");
  h+='<div class="actions">'+acts.join("")+"</div>";
  d.innerHTML=h;
  d.querySelector(".ask").addEventListener("click",function(){
    var q=s.t==="drive"?"Anything we should know about the drive "+s.label.replace("→","to")+"?":"Tell me more about "+s.name+". Anything we should know?";
    if(window.tripChat)window.tripChat.ask(q);});
  return d;
}

/* ---------- day at a glance ---------- */
function loadWeather(){
  DAYKEYS.forEach(function(k){var w=T.weather&&T.weather[k];if(!w)return;var dt=dateOf(k);
    fetch("https://api.open-meteo.com/v1/forecast?latitude="+w.lat+"&longitude="+w.lon+"&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&timezone=America%2FToronto&start_date="+dt+"&end_date="+dt)
      .then(function(r){return r.ok?r.json():Promise.reject(r.status);})
      .then(function(j){var d=j.daily;weather[k]={code:d.weather_code[0],hi:d.temperature_2m_max[0],lo:d.temperature_2m_min[0],rain:d.precipitation_probability_max[0],wind:d.wind_speed_10m_max[0],rise:d.sunrise[0].slice(11),set:d.sunset[0].slice(11)};})
      .catch(function(){weather[k]=false;})
      .then(function(){if(state.view===k)renderGlance();});
  });
}
function renderGlance(){
  var k=state.view,D=day(),segs=D.segs,w=weather[k],place=(T.weather&&T.weather[k]||{}).label||"";
  var drive=0,out=0;segs.forEach(function(s){var d=mins(s.end)-mins(s.start);if(s.t==="drive")drive+=d;else if(OUTDOORS[s.kind])out+=d;});
  var h="";
  if(w&&w.hi!=null){var c=wmo(w.code);
    h+='<div class="wx"><span class="wx-icon">'+WX[c[1]]+'</span><div><div class="wx-temp">'+Math.round(w.hi)+'°<small> / '+Math.round(w.lo)+'°</small></div>'+
       '<div class="wx-desc">'+c[0]+(w.rain!=null?" · "+w.rain+"% rain":"")+'</div><div class="wx-meta">Wind up to '+Math.round(w.wind)+' km/h · '+esc(place)+'</div></div></div>';}
  else{var dd=daysBetween(torontoNow().date,dateOf(k));
    h+='<div class="wx na"><span class="wx-icon">'+WX.part+'</span><div><div class="wx-temp">'+(w===undefined?"Loading forecast…":dd>15?"Forecast in "+(dd-15)+" days":"No forecast")+'</div><div class="wx-meta">'+esc(place)+'</div></div></div>';}
  var setT=w&&w.set?fmt(mins(w.set)):"about 6:40 PM";
  var last=segs[segs.length-1];
  h+='<dl class="stats">'+
    '<div class="stat"><dt>Leave</dt><dd>'+fmt(mins(segs[0].start))+'</dd><span class="sub">'+esc(segs[0].name.replace(/^Leave /,"from "))+'</span></div>'+
    '<div class="stat"><dt>Driving</dt><dd>'+hm(drive)+'</dd><span class="sub">plus holiday traffic</span></div>'+
    '<div class="stat"><dt>Outdoors</dt><dd>'+hm(out)+'</dd><span class="sub">hiking, paddling, lookouts</span></div>'+
    '<div class="stat"><dt>Sunset</dt><dd>'+setT+'</dd><span class="sub">'+(w&&w.rise?"sunrise "+fmt(mins(w.rise)):"")+'</span></div></dl>';
  if(liveDay()===k){var t=torontoNow().mins,cur=nowSeg(),nx=segs.filter(function(s){return s.t==="stop"&&mins(s.start)>t;})[0];
    h+='<div class="nownext"><span><b>NOW</b>'+esc(cur.t==="drive"?"Driving "+cur.label:cur.verb)+'</span>'+
      (nx?'<span><b>NEXT</b>'+esc(nx.name)+" at "+fmt(mins(nx.start))+" (in "+hm(mins(nx.start)-t)+")</span>":"<span><b>NEXT</b>"+esc(last.name)+"</span>")+"</div>";}
  $("glance").innerHTML=h;
}

/* ---------- map ---------- */
var G=null,map=null,Marker=null,lines=[],markers=[],you=null,embed=null;

function caption(){var s=state.view!=="prep"&&state.sel!=null?day().segs[state.sel]:null;
  $("mapCaption").textContent=s?(s.t==="drive"?s.label:s.num+". "+s.name):(state.view==="prep"?"The whole weekend":day().title.split(",")[0]+": whole day");}

// A bad or missing key drops back to Google's keyless embed (one place or one route at a time).
window.gm_authFailure=function(){console.warn("Google Maps rejected googleMapsKey in config.js; using the basic embed instead.");useEmbed();};
function useEmbed(){
  if(embed)return;map=null;you=null;markers=[];lines=[];
  var box=$("map");box.innerHTML="";
  embed=document.createElement("iframe");embed.title="Google Map";embed.setAttribute("allowfullscreen","");box.appendChild(embed);
  if(state.view!=="prep"&&state.sel!=null)frame(day().segs[state.sel]);else fitDay();
}
function embedTo(src){if(embed&&embed.getAttribute("src")!==src)embed.setAttribute("src",src);}
function ll2(p){return p[0]+","+p[1];}
// keep Google on the planned roads: route through Huntsville when the plan does
function viaHunts(path){return [path[0]].concat(path.slice(1,-1).filter(function(p){return p==="hunts";}),[path[path.length-1]]);}
function embedPlace(ll,z){embedTo("https://maps.google.com/maps?q="+ll2(ll)+"&z="+z+"&output=embed");}
function embedRoute(stops){embedTo("https://maps.google.com/maps?saddr="+ll2(stops[0])+"&daddr="+stops.slice(1).map(ll2).join("+to:")+"&output=embed");}

function loadMap(){
  caption();
  if(!CFG.googleMapsKey){useEmbed();return;}
  var params={v:"weekly",key:CFG.googleMapsKey};
  // Google's dynamic library loader (inline bootstrap from the Maps JS docs).
  (function(g){var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=function(){return h||(h=new Promise(function(f,n){a=m.createElement("script");e.set("libraries",Array.from(r)+"");for(k in g)e.set(k.replace(/[A-Z]/g,function(t){return "_"+t[0].toLowerCase();}),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps."+c+"apis.com/maps/api/js?"+e;d[q]=f;a.onerror=function(){h=n(Error(p+" could not load."));};m.head.append(a);}));};d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=function(f){var rest=Array.prototype.slice.call(arguments,1);return r.add(f)&&u().then(function(){return d[l].apply(d,[f].concat(rest));});};})(params);
  Promise.all([google.maps.importLibrary("maps"),google.maps.importLibrary("marker"),google.maps.importLibrary("core")]).then(function(libs){
    if(embed)return;
    G=google.maps;Marker=libs[1].AdvancedMarkerElement;
    map=new libs[0].Map($("map"),{
      center:{lat:45.45,lng:-79.0},zoom:9,mapId:CFG.googleMapId||"DEMO_MAP_ID",
      disableDefaultUI:true,zoomControl:true,zoomControlOptions:{position:G.ControlPosition.RIGHT_BOTTOM},
      clickableIcons:false,gestureHandling:wide.matches?"greedy":"cooperative",
      colorScheme:G.ColorScheme?G.ColorScheme.FOLLOW_SYSTEM:undefined
    });
    drawDay();
    if(state.view!=="prep"&&state.sel!=null)frame(day().segs[state.sel]);else fitDay();
  }).catch(function(e){console.warn(e);useEmbed();});
}

function bounds(pts){var b=new G.LatLngBounds();pts.forEach(function(p){b.extend({lat:p[0],lng:p[1]});});return b;}
function fitPts(pts,maxZoom){if(!map||!pts.length)return;
  if(pts.length===1){map.panTo({lat:pts[0][0],lng:pts[0][1]});map.setZoom(maxZoom||14);return;}
  map.fitBounds(bounds(pts),{top:60,right:30,bottom:50,left:30});
  if(maxZoom)G.event.addListenerOnce(map,"idle",function(){if(map.getZoom()>maxZoom)map.setZoom(maxZoom);});}
function allPts(D){var a=[];D.segs.forEach(function(s){if(s.pts)a=a.concat(s.pts);else a.push(LL(s.place));});return a;}
function fitDay(){
  caption();drawDay();
  if(embed){var ids=state.view==="prep"?T.dayRoutes.sat.concat(T.dayRoutes.sun.slice(1)):T.dayRoutes[state.view];embedRoute(ids.map(LL));return;}
  if(state.view==="prep"){fitPts(DAYKEYS.reduce(function(a,k){return a.concat(allPts(DAYS[k]));},[]));return;}
  fitPts(allPts(day()).filter(function(p){return p[0]>44.5;}));}
function frame(s){
  if(embed){if(s.t==="drive")embedRoute(viaHunts(s.path).map(LL));else embedPlace(LL(s.place),s.pts?14:15);return;}
  if(!map)return;
  if(s.pts&&s.pts.length>1)fitPts(s.pts,s.t==="drive"?13:15);else fitPts([LL(s.place)],14);}
$("fitBtn").addEventListener("click",function(){if(state.view!=="prep"&&state.sel!=null){state.sel=null;paintOpen();markSel();}fitDay();});

var drawnFor=null;
function line(pts,opts){var l=new G.Polyline(Object.assign({map:map,path:pts.map(function(p){return {lat:p[0],lng:p[1]};})},opts));lines.push(l);return l;}
function drawDay(){
  if(!map||drawnFor===state.view)return;drawnFor=state.view;
  lines.forEach(function(l){l.setMap(null);});lines=[];markers.forEach(function(m){m.map=null;});markers=[];
  var keys=state.view==="prep"?DAYKEYS:[state.view];
  DAYKEYS.forEach(function(k){if(keys.indexOf(k)<0)DAYS[k].segs.forEach(function(s){if(s.t==="drive")line(s.pts,{strokeColor:"#5E6B65",strokeOpacity:.35,strokeWeight:2,clickable:false});});});
  keys.forEach(function(k){DAYS[k].segs.forEach(function(s){
    if(!s.pts||s.pts.length<2)return;
    var pick=function(){if(state.view===k)select(s.i);};
    if(s.t==="drive"){line(s.pts,{strokeColor:"#ffffff",strokeOpacity:.9,strokeWeight:8,clickable:false});line(s.pts,{strokeColor:"#C2461F",strokeOpacity:1,strokeWeight:4.5}).addListener("click",pick);}
    else if(s.routeKind==="hike")line(s.pts,{strokeOpacity:0,icons:[{icon:{path:G.SymbolPath.CIRCLE,scale:2.6,fillColor:"#2F7A4E",fillOpacity:1,strokeColor:"#fff",strokeWeight:1},offset:"0",repeat:"10px"}]}).addListener("click",pick);
    else line(s.pts,{strokeOpacity:0,icons:[{icon:{path:"M 0,-1 0,1",strokeOpacity:1,strokeColor:"#2C6688",strokeWeight:4,scale:3},offset:"0",repeat:"14px"}]}).addListener("click",pick);
  });});
  // one marker per place; several stops at the same place share it ("3·9·11")
  keys.forEach(function(k){var groups={};
    DAYS[k].segs.forEach(function(s){if(s.t!=="stop")return;(groups[s.place]=groups[s.place]||[]).push(s);});
    Object.keys(groups).forEach(function(pl){var stops=groups[pl],ll=N[pl];
      var el=document.createElement("div");el.className="mk";el.style.setProperty("--k",KCOL[stops[stops.length>1?1:0].kind]);
      var badge=document.createElement("span");badge.className="mk-badge";badge.textContent=stops.map(function(s){return s.num;}).join("·");
      var name=document.createElement("span");name.className="mk-name";name.textContent=stops[0].name;el.append(badge,name);
      var m=new Marker({map:map,position:{lat:ll[0],lng:ll[1]},content:el,title:stops.map(function(s){return s.num+". "+s.name;}).join(", "),gmpClickable:true});
      m.stops=stops;m.day=k;m.el=el;m.nameEl=name;
      m.addEventListener("gmp-click",function(){
        if(state.view!==k)setView(k);
        var cur=state.sel!=null?day().segs[state.sel]:null,idx=stops.indexOf(cur),next=stops[(idx+1)%stops.length];
        select(next.i);var li=document.querySelector('#rows>li[data-i="'+next.i+'"]');if(li)li.scrollIntoView({block:"nearest",behavior:"smooth"});});
      markers.push(m);});});
  // live "you are here (per the plan)" dot, only on the day itself
  if(you){you.map=null;you=null;}
  if(liveDay()===state.view){var cur=nowSeg(),t=torontoNow().mins,a=mins(cur.start),b=mins(cur.end);
    var pos=cur.pts&&cur.pts.length>1?along(cur.pts,b>a?(t-a)/(b-a):1):LL(cur.place);
    var yd=document.createElement("div");yd.className="you";var tag=document.createElement("span");tag.className="you-tag";tag.textContent="Now (per plan)";yd.appendChild(tag);
    you=new Marker({map:map,position:{lat:pos[0],lng:pos[1]},content:yd,zIndex:1000});}
  markSel();
}
function markSel(){drawDay();var sel=state.view!=="prep"&&state.sel!=null&&day().segs[state.sel];
  markers.forEach(function(m){var on=sel&&m.day===state.view&&m.stops.indexOf(sel)>=0;m.el.classList.toggle("sel",!!on);if(on)m.nameEl.textContent=sel.name;m.zIndex=on?999:null;});}

/* ---------- start ---------- */
fetch("trip.json",{cache:"no-cache"}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();}).then(boot).catch(function(e){
  console.error(e);$("lede").textContent="Couldn't load the plan ("+e.message+"). If you opened index.html from disk, serve the folder instead: python3 -m http.server";
});
})();
