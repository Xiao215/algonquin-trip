(function(){
"use strict";
/* Trip assistant: a floating rounded box. Collapsed it's just the input; it opens into a chat
   card that can be dragged by its header (double-click the header to snap it back) or
   minimized (Esc). Ctrl/⌘+K opens it from anywhere.
   History lives in this browser only; each question sends the recent conversation to the backend,
   which streams the answer back as server-sent events. */
// An empty apiBase means "same server as this page" (the backend serves the site too).
var API=((window.TRIP_CONFIG||{}).apiBase||"").replace(/\/$/,"");
var override=new URLSearchParams(location.search).get("api");
if(override&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(override))API=override;

var KEY="alg-chat-v1",POS="alg-chat-pos",HISTORY=20;
var SUGGEST=["What's the forecast for the weekend?","What time do we leave Huntsville on Sunday?","What should I bring for the canoe?","Where should we eat dinner in Huntsville?"];
function load(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
function keep(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
var S=load(KEY)||{};S.msgs=S.msgs||[];
function save(){keep(KEY,{name:S.name,code:S.code,msgs:S.msgs.slice(-60)});}

var $=function(id){return document.getElementById(id);};
var chat=$("chat"),card=chat.querySelector(".chat-card"),head=$("chatHead"),log=$("chatLog"),form=$("chatForm"),text=$("chatText"),send=$("chatSend"),
    join=$("chatJoin"),sub=$("chatSub");
var busy=false,checked=false,pending=null,ctrl=null;
var wide=window.matchMedia?matchMedia("(min-width: 901px)"):{matches:true};

/* ---------- tiny markdown: paragraphs, lists, headings, bold, italics, code, links ---------- */
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function inline(s){
  var held=[];function hold(h){held.push(h);return "\u0000"+(held.length-1)+"\u0000";}
  s=s.replace(/`([^`]+)`/g,function(_,c){return hold("<code>"+esc(c)+"</code>");});
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,function(_,t,u){return hold('<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(t)+"</a>");});
  s=s.replace(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g,function(u){return hold('<a href="'+esc(u)+'" target="_blank" rel="noopener">'+esc(u.replace(/^https?:\/\/(www\.)?/,"").slice(0,48))+"</a>");});
  s=esc(s).replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/(^|[\s(])[*_]([^*_\s][^*_]*)[*_](?=[\s).,;:!?]|$)/g,"$1<i>$2</i>");
  return s.replace(/\u0000(\d+)\u0000/g,function(_,i){return held[+i];});
}
function md(src){
  var out=[],para=[],list=null;
  function flush(){if(para.length){out.push("<p>"+para.map(inline).join("<br>")+"</p>");para=[];}if(list){out.push("<"+list.t+">"+list.items.map(function(i){return "<li>"+inline(i)+"</li>";}).join("")+"</"+list.t+">");list=null;}}
  src.split("\n").forEach(function(line){
    var m;
    if(!line.trim()){flush();return;}
    if((m=line.match(/^\s*#{1,6}\s+(.*)/))){flush();out.push("<h4>"+inline(m[1])+"</h4>");return;}
    if((m=line.match(/^\s*[-*•]\s+(.*)/))){if(para.length||(list&&list.t!=="ul"))flush();list=list||{t:"ul",items:[]};list.items.push(m[1]);return;}
    if((m=line.match(/^\s*\d+[.)]\s+(.*)/))){if(para.length||(list&&list.t!=="ol"))flush();list=list||{t:"ol",items:[]};list.items.push(m[1]);return;}
    if(list&&/^\s{2,}/.test(line)){list.items[list.items.length-1]+=" "+line.trim();return;}
    if(list)flush();para.push(line);
  });
  flush();return out.join("");
}
function clock(ts){return ts?new Date(ts).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}):"";}

/* ---------- open / close / expand ---------- */
function isOpen(){return chat.dataset.open==="true";}
function openChat(){if(isOpen())return;chat.dataset.open="true";render();clampPos();if(!checked)health();
  setTimeout(function(){(S.code?text:$("joinName")).focus();},0);}
function closeChat(){chat.dataset.open="false";text.blur();clampPos();}
text.addEventListener("focus",openChat);
text.addEventListener("click",openChat);
$("chatMin").addEventListener("click",closeChat);
chat.addEventListener("keydown",function(e){if(e.key==="Escape"&&isOpen()){e.preventDefault();if(busy&&ctrl)ctrl.abort();else closeChat();}});
document.addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openChat();text.focus();}});
$("chatNew").addEventListener("click",function(){if(busy)return;S.msgs=[];save();render();text.focus();});

/* ---------- drag by the header (desktop) ---------- */
var drag=null;
function place(x,y){var r=card.getBoundingClientRect(),m=8;
  x=Math.max(m,Math.min(innerWidth-r.width-m,x));y=Math.max(m,Math.min(innerHeight-r.height-m,y));
  chat.classList.add("moved");chat.style.left=x+"px";chat.style.top=y+"px";return [x,y];}
function clampPos(){if(!chat.classList.contains("moved"))return;if(!wide.matches){unplace();return;}
  requestAnimationFrame(function(){var r=card.getBoundingClientRect();place(r.left,r.top);});}
function unplace(){chat.classList.remove("moved");chat.style.left="";chat.style.top="";}
head.addEventListener("pointerdown",function(e){
  if(!wide.matches||e.button!==0||e.target.closest("button"))return;
  var r=card.getBoundingClientRect();drag={dx:e.clientX-r.left,dy:e.clientY-r.top,id:e.pointerId};
  try{head.setPointerCapture(e.pointerId);}catch(_){}head.classList.add("dragging");});
head.addEventListener("pointermove",function(e){if(!drag||e.pointerId!==drag.id)return;place(e.clientX-drag.dx,e.clientY-drag.dy);});
function endDrag(){if(!drag)return;drag=null;head.classList.remove("dragging");
  if(chat.classList.contains("moved"))keep(POS,[parseFloat(chat.style.left),parseFloat(chat.style.top)]);}
head.addEventListener("pointerup",endDrag);head.addEventListener("pointercancel",endDrag);
head.addEventListener("dblclick",function(e){if(e.target.closest("button"))return;unplace();keep(POS,null);});
window.addEventListener("resize",clampPos);
(function(){var p=load(POS);if(p&&wide.matches){chat.classList.add("moved");chat.style.left=p[0]+"px";chat.style.top=p[1]+"px";}})();

/* ---------- rendering ---------- */
function userMsg(m){var d=document.createElement("div");d.className="m m-user";
  d.innerHTML='<div class="m-bubble"></div>';d.firstChild.textContent=m.content;log.appendChild(d);return d;}
function botMsg(m){var d=document.createElement("div");d.className="m m-bot";
  d.innerHTML='<div class="m-content"></div><div class="m-tools"></div>';
  log.appendChild(d);if(m)fillBot(d,m);return d;}
function fillBot(d,m){d.querySelector(".m-content").innerHTML=md(m.content)+(m.stopped?'<p class="m-note">Stopped</p>':"");
  var tools=d.querySelector(".m-tools");tools.innerHTML='<span class="m-time">'+esc(clock(m.ts))+'</span><button class="text-btn" type="button">Copy</button>';
  tools.querySelector("button").addEventListener("click",function(){var b=this;
    (navigator.clipboard?navigator.clipboard.writeText(m.content):Promise.reject()).then(function(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy";},1500);}).catch(function(){});});}
function errMsg(msg,retry){var d=document.createElement("div");d.className="m m-err";
  d.innerHTML='<span></span>'+(retry?'<button class="text-btn" type="button">Try again</button>':"");
  d.firstChild.textContent=msg;if(retry)d.querySelector("button").addEventListener("click",function(){d.remove();retry();});log.appendChild(d);scroll();}
function scroll(){log.scrollTop=log.scrollHeight;}
function empty(){var e=document.createElement("div");e.className="chat-empty";
  e.innerHTML='<h3>Hi '+esc(S.name||"there")+'</h3><p>Ask anything about the weekend. I know the plan and can look things up.</p><div class="sugg"></div>';
  var g=e.querySelector(".sugg");
  SUGGEST.forEach(function(q){var b=document.createElement("button");b.type="button";b.textContent=q;b.onclick=function(){ask(q);};g.appendChild(b);});
  log.appendChild(e);}
function render(){
  var joined=!!S.code;
  join.hidden=joined;log.hidden=!joined;chat.classList.toggle("locked",!joined);
  if(!joined){$("joinName").value=S.name||"";return;}
  log.innerHTML="";
  if(!S.msgs.length)empty();
  S.msgs.forEach(function(m){if(m.role==="user")userMsg(m);else botMsg(m);});
  scroll();
}
function setStatus(state,msg){sub.className="chat-sub"+(state?" "+state:"");sub.textContent=msg;}
function health(){
  fetch(API+"/api/health").then(function(r){return r.ok?r.json():Promise.reject();})
    .then(function(){checked=true;setStatus("ok","Online · knows the plan, can search the web");})
    .catch(function(){setStatus("down","Offline right now. Try again later");});
}
function setBusy(on){busy=on;chat.classList.toggle("busy",on);send.setAttribute("aria-label",on?"Stop":"Send");send.title=on?"Stop (Esc)":"Send";}

/* ---------- join ---------- */
join.addEventListener("submit",function(e){
  e.preventDefault();var name=$("joinName").value.trim(),code=$("joinCode").value.trim(),err=$("joinErr");
  if(!name||!code)return;err.textContent="Checking…";
  fetch(API+"/api/check",{method:"POST",headers:{"X-Trip-Code":code}}).then(function(r){
    if(r.status===401){err.textContent="That trip code didn't work.";return;}
    if(!r.ok)throw new Error();
    S.name=name;S.code=code;save();err.textContent="";render();
    if(pending){var q=pending;pending=null;text.value="";grow();ask(q);}else text.focus();
  }).catch(function(){err.textContent="Can't reach the trip server. It may be offline.";});
});

/* ---------- ask ---------- */
function history(){
  var h=S.msgs.filter(function(m){return m.content;}).slice(-HISTORY);
  while(h.length&&h[0].role!=="user")h.shift();
  return h.map(function(m){return {role:m.role,content:m.content};});
}
function ask(q){
  q=q.trim();if(!q||busy)return;
  openChat();
  if(!S.code){pending=q;text.value=q;grow();render();return;}
  setBusy(true);
  var um={role:"user",content:q,ts:Date.now()};S.msgs.push(um);save();
  var e0=log.querySelector(".chat-empty");if(e0)e0.remove();
  userMsg(um);
  var el=botMsg(null),content=el.querySelector(".m-content");
  content.innerHTML='<div class="thinking">Thinking<span class="dots"><i></i><i></i><i></i></span></div>';scroll();
  var acc="",ctx=null;try{ctx=window.tripApp&&window.tripApp.context();}catch(e){}
  ctrl=window.AbortController?new AbortController():null;

  function finish(stopped){var m={role:"assistant",content:acc,ts:Date.now(),stopped:stopped||undefined};S.msgs.push(m);save();fillBot(el,m);}
  fetch(API+"/api/chat",{method:"POST",signal:ctrl&&ctrl.signal,headers:{"Content-Type":"application/json","X-Trip-Code":S.code},
    body:JSON.stringify({name:S.name,messages:history(),context:ctx})})
  .then(function(r){
    if(r.status===401){S.code=null;save();throw new Error("The trip code changed. Enter the new one to keep chatting.");}
    if(!r.ok)return r.json().catch(function(){return {};}).then(function(j){throw new Error(j.detail||"The trip server had a problem ("+r.status+").");});
    var reader=r.body.getReader(),dec=new TextDecoder(),buf="";
    function handle(ev){
      if(ev.type==="text"){acc+=ev.text;content.innerHTML=md(acc);scroll();}
      else if(ev.type==="status"&&!acc){content.innerHTML='<div class="thinking">'+esc(ev.text)+'<span class="dots"><i></i><i></i><i></i></span></div>';}
      else if(ev.type==="error"){throw new Error(ev.message);}
    }
    function pump(){return reader.read().then(function(res){
      buf+=dec.decode(res.value||new Uint8Array(),{stream:!res.done});
      var parts=buf.split("\n\n");buf=parts.pop();
      parts.forEach(function(p){var line=p.split("\n").filter(function(l){return l.indexOf("data:")===0;}).map(function(l){return l.slice(5).trim();}).join("");if(line)handle(JSON.parse(line));});
      if(!res.done)return pump();
    });}
    return pump();
  })
  .then(function(){if(!acc)throw new Error("No answer came back.");finish();})
  .catch(function(e){
    if(e&&e.name==="AbortError"){if(acc)finish(true);else{el.remove();S.msgs.pop();save();}return;}
    var msg=e&&e.message&&e.message!=="Failed to fetch"?e.message:"Can't reach the trip server. It may be offline.";
    if(acc){finish();errMsg(msg);}
    else{el.remove();S.msgs.pop();save();
      var userEl=log.lastElementChild;
      errMsg(msg,S.code?function(){if(userEl&&userEl.classList.contains("m-user"))userEl.remove();ask(q);}:null);}
    if(!S.code)render();
  })
  .then(function(){setBusy(false);ctrl=null;scroll();});
}

form.addEventListener("submit",function(e){e.preventDefault();
  if(busy){if(ctrl)ctrl.abort();return;}
  var q=text.value;if(!q.trim()){openChat();return;}text.value="";grow();ask(q);});
text.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!busy)form.requestSubmit();}});
function grow(){text.style.height="auto";text.style.height=Math.min(text.scrollHeight,160)+"px";chat.classList.toggle("typed",!!text.value.trim());}
text.addEventListener("input",grow);

window.tripChat={ask:function(q){if(busy){openChat();return;}ask(q);}};
})();
