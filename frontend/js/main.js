if(sessionStorage.getItem("sbLogged")!=="1") location.href="login.html";
const u=JSON.parse(localStorage.getItem("sbUser")||"{}");
document.getElementById("user").textContent=u.name||"there";
document.getElementById("basketPreview").textContent=sessionStorage.getItem("activeBasketId")||"Not selected";
document.getElementById("lastBarcode").textContent=localStorage.getItem("lastBarcode")||"Not scanned";
document.getElementById("logout").onclick=()=>{sessionStorage.clear();location.href="login.html"};

