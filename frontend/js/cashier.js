const keyInput=document.getElementById("key"),rows=document.getElementById("rows"),msg=document.getElementById("msg");
keyInput.value=sessionStorage.getItem("cashierKey")||"";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,method="GET"){const r=await fetch(BACKEND_URL+path,{method,headers:{"x-api-key":keyInput.value.trim(),"Content-Type":"application/json"},body:method==="POST"?"{}":undefined});const d=await r.json();if(!r.ok)throw new Error(d.message||("HTTP "+r.status));return d}
async function load(){
  msg.textContent="Loading…";sessionStorage.setItem("cashierKey",keyInput.value.trim());
  try{const d=await api("/api/orders?limit=100");msg.textContent=d.orders.length+" order(s)";
    rows.innerHTML=d.orders.length?"":'<tr><td colspan="7" class="muted">No orders yet.</td></tr>';
    d.orders.forEach(o=>{const tr=document.createElement("tr");const loc=o.location?`<a href="https://www.google.com/maps?q=${o.location.lat},${o.location.lng}" target="_blank" rel="noopener">${esc(o.storeName)} 📍</a>`:esc(o.locationText||o.storeName);
      tr.innerHTML=`<td><b>${esc(o.orderId)}</b><br>${esc(o.basketId)}</td><td>${esc(o.customerName)}<br><small>${esc(o.customerPhone)}</small></td><td>${esc(o.deviceDateTime||new Date(o.createdAt).toLocaleString())}</td><td>${loc}</td><td>${o.itemCount}<ul class="items">${o.items.map(i=>`<li>${esc(i.name)} ×${i.qty} — ₹${i.price}</li>`).join("")}</ul></td><td><b>₹${Number(o.total).toFixed(2)}</b>${o.totalMatches?"":"<br><small style='color:#b91c1c'>mismatch ₹"+o.serverTotal+"</small>"}</td><td class="${o.status==="Paid"?"paid":"pend"}">${esc(o.status)}${o.status==="Paid"?"":`<br><button class="btn primary compact" data-id="${esc(o.orderId)}">Mark paid</button>`}</td>`;
      rows.appendChild(tr)});
    rows.querySelectorAll("button[data-id]").forEach(b=>b.onclick=async()=>{try{await api("/api/orders/"+encodeURIComponent(b.dataset.id)+"/paid","POST");load()}catch(e){msg.textContent=e.message}});
  }catch(e){msg.textContent="Error: "+e.message}
}
document.getElementById("load").onclick=load;
document.getElementById("reset").onclick=async()=>{if(!confirm("Free all baskets B1–B5?"))return;try{const d=await api("/api/admin/reset-baskets","POST");msg.textContent="Baskets reset ("+d.reset+")."}catch(e){msg.textContent="Error: "+e.message}};
