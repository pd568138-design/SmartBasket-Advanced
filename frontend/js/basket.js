if(sessionStorage.getItem("sbLogged")!=="1") location.href="login.html";
const grid=document.getElementById("basketGrid"), message=document.getElementById("basketMessage"), refresh=document.getElementById("refreshBaskets");
const basketIds=["B1","B2","B3","B4","B5"];
function say(text,type="") { message.textContent=text; message.className="basket-message "+type; }
async function loadBaskets(){
  grid.innerHTML='<div class="glass basket-loading">Checking live status…</div>'; refresh.disabled=true; say("");
  try {
    const response=await fetch(BACKEND_URL+"/api/baskets"); const data=await response.json();
    if(!response.ok||!data.success) throw new Error(data.message||"Could not load basket status.");
    const statuses=new Map((data.baskets||[]).map(b=>[b.basketId,b.status]));
    grid.innerHTML="";
    basketIds.forEach(id=>{
      const status=statuses.get(id)||"Available", available=status==="Available";
      const card=document.createElement("article"); card.className="basket-card glass "+(available?"available":"in-use");
      card.innerHTML=`<div class="basket-icon">🧺</div><h2>${id}</h2><span class="basket-pill">${available?"● Available":"● In Use"}</span><p>${available?"Ready to select":"Currently reserved"}</p><button class="btn ${available?"primary":"secondary"}" ${available?"":"disabled"}>${available?"Select basket →":"Unavailable"}</button>`;
      if(available) card.querySelector("button").addEventListener("click",()=>selectBasket(id,card));
      grid.appendChild(card);
    });
    if(!grid.children.length) grid.innerHTML='<div class="glass basket-loading">No baskets returned by the server.</div>';
  } catch(e) { grid.innerHTML='<div class="glass basket-error">Unable to load live basket status.<br><small></small></div>'; grid.querySelector("small").textContent=e.message+" Check the Render URL and /api/health."; say("Basket service connection failed. Check your Render URL and try again.","error"); }
  finally {refresh.disabled=false;}
}
async function selectBasket(id,card){
  const button=card.querySelector("button"); button.disabled=true; button.textContent="Reserving…"; say("Reserving "+id+"…");
  try {
    const response=await fetch(BACKEND_URL+"/api/baskets/"+encodeURIComponent(id)+"/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
    const data=await response.json(); if(!response.ok||!data.success) throw new Error(data.message||"Basket selection failed.");
    sessionStorage.setItem("activeBasketId",data.basketId); sessionStorage.setItem("activeBasketSessionId",data.sessionId); localStorage.setItem("basketId",data.basketId);
    location.href="scanner.html?basketId="+encodeURIComponent(data.basketId);
  } catch(e){say(e.message,"error"); await loadBaskets();}
}
refresh.addEventListener("click",loadBaskets); loadBaskets();
