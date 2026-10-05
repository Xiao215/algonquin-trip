(function(){
"use strict";
/* Trip assistant as a terminal-style command bar (think Claude Code): click or press Ctrl/⌘+K,
   type, Enter. The transcript opens above the prompt; Esc hides it (or stops an answer in progress).
   Type /clear to start over. History lives in this browser only; each question sends the recent
   conversation to the backend, which streams the answer back as server-sent events. */
// An empty apiBase means "same server as this page" (the backend serves the site too).
var API=((window.TRIP_CONFIG||{}).apiBase||"").replace(/\/$/,"");
var override=new URLSearchParams(location.search).get("api");
if(override&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(override))API=override;

var KEY="alg-chat-v1",HISTORY=20;
var SUGGEST=["What's the forecast for the weekend?","What time do we leave Huntsville on Sunday?","What should I bring for the canoe?","Where should we eat dinner in Bracebridge?"];
var SPIN=["·","✢","✳","✶","✻","✽","✻","✶","✳","✢"];

function load(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
function keep(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
var S=load(KEY)||{};S.msgs=S.msgs||[];
function save(){keep(KEY,{code:S.code,msgs:S.msgs.slice(-60)});}

var $=function(id){return document.getElementById(id);};
var chat=$("chat"),log=$("chatLog"),form=$("chatForm"),text=$("chatText"),join=$("chatJoin"),sub=$("chatSub");
var busy=false,checked=false,needCode=false,pending=null,ctrl=null;
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

/* ---------- open / hide ---------- */
function isOpen(){return chat.dataset.open==="true";}
function openChat(){if(isOpen())return;chat.dataset.open="true";render();if(!checked)health();}
function closeChat(){chat.dataset.open="false";text.blur();}
text.addEventListener("focus",openChat);
document.addEventListener("keydown",function(e){
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openChat();text.focus();}
  else if(e.key==="Escape"&&isOpen()){e.preventDefault();if(busy&&ctrl)ctrl.abort();else closeChat();}
});
// clicking anywhere else on the page tucks the transcript away
document.addEventListener("pointerdown",function(e){if(isOpen()&&!chat.contains(e.target)&&!e.target.closest(".ask"))closeChat();});

/* ---------- transcript ---------- */
function scroll(){log.scrollTop=log.scrollHeight;}
function userLine(m){var d=document.createElement("div");d.className="l-user";d.innerHTML='<span class="p">›</span><span class="txt"></span>';d.lastChild.textContent=m.content;log.appendChild(d);return d;}
function botLine(m){var d=document.createElement("div");d.className="l-bot";d.innerHTML='<span class="dot" aria-hidden="true">●</span><div class="m-content"></div>';log.appendChild(d);if(m)fillBot(d,m);return d;}
function fillBot(d,m){d.querySelector(".m-content").innerHTML=md(m.content);
  var t=d.querySelector(".l-tools")||d.appendChild(document.createElement("div"));t.className="l-tools";
  t.innerHTML="<span>"+esc(clock(m.ts))+(m.stopped?" · stopped":"")+'</span><button type="button">copy</button>';
  t.querySelector("button").addEventListener("click",function(){var b=this;
    (navigator.clipboard?navigator.clipboard.writeText(m.content):Promise.reject()).then(function(){b.textContent="copied";setTimeout(function(){b.textContent="copy";},1500);}).catch(function(){});});}
function errLine(msg,retry){var d=document.createElement("div");d.className="l-err";d.textContent="⎿ "+msg;
  if(retry){var b=document.createElement("button");b.type="button";b.className="cli-link";b.textContent="retry";b.onclick=function(){d.remove();retry();};d.appendChild(b);}
  log.appendChild(d);scroll();}
function note(msg){var d=document.createElement("div");d.className="l-note";d.textContent=msg;log.appendChild(d);scroll();}
function empty(){var e=document.createElement("div");e.className="l-empty";e.innerHTML="<span>Ask anything about the weekend. Try:</span>";
  SUGGEST.forEach(function(q){var b=document.createElement("button");b.type="button";b.textContent=q;b.onclick=function(){ask(q);};e.appendChild(b);});log.appendChild(e);}
function render(){
  join.hidden=!(needCode&&!S.code);
  log.innerHTML="";
  if(!S.msgs.length)empty();
  S.msgs.forEach(function(m){if(m.role==="user")userLine(m);else botLine(m);});
  scroll();
}
function setStatus(state,msg){sub.className="cli-status"+(state?" "+state:"");sub.textContent=msg;}
function health(){
  fetch(API+"/api/health").then(function(r){return r.ok?r.json():Promise.reject();})
    .then(function(j){checked=true;needCode=!!j.code;setStatus("ok",(j.local?"local claude":"claude")+" · knows the plan");if(isOpen())render();})
    .catch(function(){setStatus("down","trip server offline");});
}
health();

/* ---------- access code ---------- */
join.addEventListener("submit",function(e){
  e.preventDefault();var code=$("joinCode").value.trim(),err=$("joinErr");if(!code)return;err.textContent="checking…";
  fetch(API+"/api/check",{method:"POST",headers:{"X-Access-Code":code}}).then(function(r){
    if(r.status===401){err.textContent="wrong code";return;}
    if(!r.ok)throw new Error();
    S.code=code;save();err.textContent="";join.hidden=true;
    if(pending){var q=pending;pending=null;ask(q);}else text.focus();
  }).catch(function(){err.textContent="can't reach the server";});
});

/* ---------- ask ---------- */
function history(){
  var h=S.msgs.filter(function(m){return m.content;}).slice(-HISTORY);
  while(h.length&&h[0].role!=="user")h.shift();
  return h.map(function(m){return {role:m.role,content:m.content};});
}
function setBusy(on){busy=on;chat.classList.toggle("busy",on);$("chatSend").textContent=on?"■":"↵";}
function ask(q){
  q=q.trim();if(!q||busy)return;
  openChat();
  if(q==="/clear"||q==="/new"){S.msgs=[];save();render();return;}
  if(q==="/help"){note("Enter sends · Shift+Enter adds a line · Esc hides or stops · /clear starts over");return;}
  if(needCode&&!S.code){pending=q;join.hidden=false;$("joinCode").focus();return;}
  setBusy(true);
  var um={role:"user",content:q,ts:Date.now()};S.msgs.push(um);save();
  var e0=log.querySelector(".l-empty");if(e0)e0.remove();
  var uEl=userLine(um);
  var st=document.createElement("div");st.className="l-status";st.innerHTML='<span class="spin">✻</span><span class="w">Thinking…</span><span class="dim">(esc to stop)</span>';log.appendChild(st);scroll();
  var f=0,spin=setInterval(function(){st.firstChild.textContent=SPIN[f++%SPIN.length];},110);
  var el=null,acc="",ctx=null;try{ctx=window.tripApp&&window.tripApp.context();}catch(e){}
  ctrl=window.AbortController?new AbortController():null;

  function stopSpin(){clearInterval(spin);st.remove();}
  function finish(stopped){var m={role:"assistant",content:acc,ts:Date.now(),stopped:stopped||undefined};S.msgs.push(m);save();fillBot(el,m);}
  fetch(API+"/api/chat",{method:"POST",signal:ctrl&&ctrl.signal,headers:{"Content-Type":"application/json","X-Access-Code":S.code||""},
    body:JSON.stringify({name:"",messages:history(),context:ctx})})
  .then(function(r){
    if(r.status===401){S.code=null;needCode=true;save();throw new Error("This server needs the access code.");}
    if(!r.ok)return r.json().catch(function(){return {};}).then(function(j){throw new Error(j.detail||"The trip server had a problem ("+r.status+").");});
    var reader=r.body.getReader(),dec=new TextDecoder(),buf="";
    function handle(ev){
      if(ev.type==="text"){if(!el){stopSpin();el=botLine(null);}acc+=ev.text;el.querySelector(".m-content").innerHTML=md(acc);scroll();}
      else if(ev.type==="status"&&!acc){st.querySelector(".w").textContent=ev.text+"…";}
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
  .then(function(){stopSpin();if(!acc)throw new Error("No answer came back.");finish();})
  .catch(function(e){
    stopSpin();
    if(e&&e.name==="AbortError"){if(acc)finish(true);else{uEl.remove();S.msgs.pop();save();note("stopped");}return;}
    var msg=e&&e.message&&e.message!=="Failed to fetch"?e.message:"Can't reach the trip server. It may be offline.";
    if(acc){finish();errLine(msg);}
    else{S.msgs.pop();save();
      if(needCode&&!S.code){uEl.remove();pending=q;join.hidden=false;errLine(msg);}
      else errLine(msg,function(){uEl.remove();ask(q);});}
  })
  .then(function(){setBusy(false);ctrl=null;scroll();});
}

form.addEventListener("submit",function(e){e.preventDefault();
  if(busy){if(ctrl)ctrl.abort();return;}
  var q=text.value;if(!q.trim())return;text.value="";grow();ask(q);});
text.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!busy)form.requestSubmit();}});
function grow(){text.style.height="auto";text.style.height=Math.min(text.scrollHeight,150)+"px";}
text.addEventListener("input",grow);

window.tripChat={ask:function(q){openChat();if(busy)return;ask(q);}};
})();
