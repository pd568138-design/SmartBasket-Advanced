if(sessionStorage.getItem("sbLogged")!=="1") location.href="login.html";
const u=JSON.parse(localStorage.getItem("sbUser")||"{}");
document.getElementById("user").textContent=u.name||"there";
document.getElementById("basketPreview").textContent=sessionStorage.getItem("activeBasketId")||"Not selected";
document.getElementById("lastBarcode").textContent=localStorage.getItem("lastBarcode")||"Not scanned";
document.getElementById("logout").onclick=async()=>{const id=sessionStorage.getItem("activeBasketId"),sid=sessionStorage.getItem("activeBasketSessionId");if(id&&sid){try{await fetch(BACKEND_URL+"/api/baskets/"+encodeURIComponent(id)+"/release",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:sid}),keepalive:true})}catch(e){}}sessionStorage.clear();location.href="login.html"};
