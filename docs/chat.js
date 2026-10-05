(function(){
"use strict";
/* Trip assistant docked under the plan: click the bar or press Ctrl/⌘+K, type, Enter. The panel
   stays open until you hide it (the ⌄ button or Esc); an answer keeps streaming while it's hidden and
   the bar says when it's ready. "New chat" starts over. Anything asked while an answer is in progress
   waits its turn. History lives in this browser only; each question sends the recent conversation to
   the backend, which streams the answer back as server-sent events. */
// An empty apiBase means "same server as this page" (the backend serves the site too).
var API=((window.TRIP_CONFIG||{}).apiBase||"").replace(/\/$/,"");
var override=new URLSearchParams(location.search).get("api");
if(override&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(override))API=override;

var KEY="alg-chat-v1",HISTORY=20;
var SUGGEST=["What's the forecast for the weekend?","What time do we leave Huntsville on Sunday?","What should I bring for the canoe?","Where should we eat dinner in Bracebridge?"];

function load(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
function keep(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
var S=load(KEY)||{};S.msgs=S.msgs||[];
function save(){keep(KEY,{code:S.code,msgs:S.msgs.slice(-60)});}

var $=function(id){return document.getElementById(id);};
var chat=$("chat"),log=$("chatLog"),form=$("chatForm"),text=$("chatText"),join=$("chatJoin"),sub=$("chatSub"),badge=$("chatBadge"),send=$("chatSend");
var busy=false,checked=false,needCode=false,pending=null,ctrl=null,queue=[],gen=0,stick=true;
if(!/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent))$("chatKbd").textContent="Ctrl K";

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

/* ---------- open / hide (hiding never interrupts an answer) ---------- */
function isOpen(){return chat.dataset.open==="true";}
function openChat(){if(isOpen())return;chat.dataset.open="true";setBadge();scroll(true);if(!checked)health();}
function closeChat(){chat.dataset.open="false";text.blur();setBadge();}
// the collapsed bar says when an answer is still coming or has arrived while hidden
function setBadge(fresh){
  if(isOpen()){badge.hidden=true;return;}
  if(busy){badge.hidden=false;badge.className="cli-badge";badge.textContent="Answering…";}
  else if(fresh){badge.hidden=false;badge.className="cli-badge new";badge.textContent="New reply";}
  else if(fresh===undefined)return;
  else badge.hidden=true;
}
text.addEventListener("focus",openChat);
badge.addEventListener("click",function(){openChat();text.focus();});
$("chatHide").addEventListener("click",closeChat);
$("chatNew").addEventListener("click",newChat);
document.addEventListener("keydown",function(e){
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openChat();text.focus();}
  else if(e.key==="Escape"&&isOpen()){e.preventDefault();closeChat();}
});

/* ---------- transcript (built once; new lines are appended, so hiding/showing never loses anything) ---------- */
log.addEventListener("scroll",function(){stick=log.scrollHeight-log.scrollTop-log.clientHeight<48;});
function scroll(force){if(force||stick)log.scrollTop=log.scrollHeight;}
function add(el){var e0=log.querySelector(".l-empty");if(e0)e0.remove();log.appendChild(el);return el;}
function userLine(m){var d=document.createElement("div");d.className="l-user";d.textContent=m.content;return add(d);}
function botLine(m){var d=document.createElement("div");d.className="l-bot";d.innerHTML='<div class="m-content"></div>';add(d);if(m)fillBot(d,m);return d;}
function fillBot(d,m){d.querySelector(".m-content").innerHTML=md(m.content);
  var t=d.querySelector(".l-tools")||d.appendChild(document.createElement("div"));t.className="l-tools";
  t.innerHTML="<span>"+esc(clock(m.ts))+(m.stopped?" · stopped early":"")+'</span><button type="button">Copy</button>';
  t.querySelector("button").addEventListener("click",function(){var b=this;
    (navigator.clipboard?navigator.clipboard.writeText(m.content):Promise.reject()).then(function(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy";},1500);}).catch(function(){});});}
function errLine(msg,retry){var d=document.createElement("div");d.className="l-err";d.textContent=msg;
  if(retry){var b=document.createElement("button");b.type="button";b.className="cli-link";b.textContent="Try again";b.onclick=function(){d.remove();retry();};d.appendChild(b);}
  add(d);scroll(true);}
function note(msg){var d=document.createElement("div");d.className="l-note";d.textContent=msg;add(d);scroll(true);return d;}
function empty(){var e=document.createElement("div");e.className="l-empty";e.innerHTML="<p>Ask anything about the weekend. For example:</p>";
  SUGGEST.forEach(function(q){var b=document.createElement("button");b.type="button";b.textContent=q;b.onclick=function(){ask(q);};e.appendChild(b);});log.appendChild(e);}
function render(){
  log.innerHTML="";
  if(!S.msgs.length)empty();
  S.msgs.forEach(function(m){if(m.role==="user")userLine(m);else botLine(m);});
  scroll(true);
}
function showJoin(){join.hidden=!(needCode&&!S.code);}
function setStatus(state,msg){sub.className="cli-status"+(state?" "+state:"");sub.textContent=msg;}
function health(){
  fetch(API+"/api/health").then(function(r){return r.ok?r.json():Promise.reject();})
    .then(function(j){checked=true;needCode=!!j.code;setStatus("ok",j.local?"Online (local)":"Online");showJoin();})
    .catch(function(){setStatus("down","Offline");});
}
render();health();

/* ---------- start over ---------- */
function newChat(){
  gen++;if(ctrl)ctrl.abort();
  queue=[];pending=null;S.msgs=[];save();setBusy(false);ctrl=null;
  render();openChat();text.focus();
}

/* ---------- access code ---------- */
join.addEventListener("submit",function(e){
  e.preventDefault();var code=$("joinCode").value.trim(),err=$("joinErr");if(!code)return;err.textContent="Checking…";
  fetch(API+"/api/check",{method:"POST",headers:{"X-Access-Code":code}}).then(function(r){
    if(r.status===401){err.textContent="That code didn't work.";return;}
    if(!r.ok)throw new Error();
    S.code=code;save();err.textContent="";join.hidden=true;
    if(pending){var q=pending;pending=null;ask(q);}else text.focus();
  }).catch(function(){err.textContent="Can't reach the server.";});
});

/* ---------- ask ---------- */
function history(){
  var h=S.msgs.filter(function(m){return m.content;}).slice(-HISTORY);
  while(h.length&&h[0].role!=="user")h.shift();
  return h.map(function(m){return {role:m.role,content:m.content};});
}
function setBusy(on){busy=on;chat.classList.toggle("busy",on);send.setAttribute("aria-label",on?"Stop answering":"Send");send.title=on?"Stop":"Send";setBadge(false);}
// a question asked mid-answer waits its turn instead of cutting the answer off
function enqueue(q){queue.push({q:q,el:note("Up next: "+q)});}
function next(){if(busy||!queue.length)return;var n=queue.shift();n.el.remove();ask(n.q);}
function ask(q){
  q=q.trim();if(!q)return;
  openChat();
  if(q==="/clear"||q==="/new"){newChat();return;}
  if(busy){enqueue(q);return;}
  if(needCode&&!S.code){pending=q;showJoin();$("joinCode").focus();return;}
  var my=gen;setBusy(true);
  var um={role:"user",content:q,ts:Date.now()};S.msgs.push(um);save();
  var uEl=userLine(um);
  var st=add(document.createElement("div"));st.className="l-status";st.innerHTML='<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="w">Thinking</span>';scroll(true);
  var el=null,acc="",ctx=null;try{ctx=window.tripApp&&window.tripApp.context();}catch(e){}
  ctrl=window.AbortController?new AbortController():null;

  function finish(stopped){var m={role:"assistant",content:acc,ts:Date.now(),stopped:stopped||undefined};S.msgs.push(m);save();fillBot(el,m);}
  fetch(API+"/api/chat",{method:"POST",signal:ctrl&&ctrl.signal,headers:{"Content-Type":"application/json","X-Access-Code":S.code||""},
    body:JSON.stringify({name:"",messages:history(),context:ctx})})
  .then(function(r){
    if(r.status===401){S.code=null;needCode=true;save();throw new Error("This server needs the access code.");}
    if(!r.ok)return r.json().catch(function(){return {};}).then(function(j){throw new Error(j.detail||"The trip server had a problem ("+r.status+").");});
    var reader=r.body.getReader(),dec=new TextDecoder(),buf="";
    function handle(ev){
      if(my!==gen)return;
      if(ev.type==="text"){if(!el){st.remove();el=botLine(null);}acc+=ev.text;el.querySelector(".m-content").innerHTML=md(acc);scroll();}
      else if(ev.type==="status"&&!acc){st.querySelector(".w").textContent=ev.text;}
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
  .then(function(){if(my!==gen)return;st.remove();if(!acc)throw new Error("No answer came back.");finish();})
  .catch(function(e){
    if(my!==gen)return; // "New chat" already cleared everything
    st.remove();
    if(e&&e.name==="AbortError"){if(acc)finish(true);else{uEl.remove();S.msgs.pop();save();note("Stopped before an answer came back.");}return;}
    var msg=e&&e.message&&e.message!=="Failed to fetch"?e.message:"Can't reach the trip server. It may be offline.";
    if(acc){finish();errLine(msg);}
    else{S.msgs.pop();save();
      if(needCode&&!S.code){uEl.remove();pending=q;showJoin();errLine(msg);}
      else errLine(msg,function(){uEl.remove();ask(q);});}
  })
  .then(function(){if(my!==gen)return;ctrl=null;setBusy(false);setBadge(true);scroll();next();});
}

form.addEventListener("submit",function(e){e.preventDefault();
  var q=text.value;
  if(busy&&!q.trim()){if(ctrl)ctrl.abort();return;} // the send button doubles as Stop
  if(!q.trim())return;text.value="";grow();ask(q);});
text.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(text.value.trim())form.requestSubmit();}});
function grow(){text.style.height="auto";text.style.height=Math.min(text.scrollHeight,150)+"px";chat.classList.toggle("typed",!!text.value.trim());}
text.addEventListener("input",grow);

window.tripChat={ask:function(q){ask(q);}};
})();
