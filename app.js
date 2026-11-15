/* Drop Arua — lightweight, client-side PWA.
   Set DISPATCH_PHONE to your WhatsApp number in international format, digits only.
   Uganda example: 256772000000 (no +, spaces or leading 0). */
const DISPATCH_PHONE = "256760360914";
const STORAGE_ORDERS = "drop_orders";
const STORAGE_PROFILE = "drop_customer";
const STORAGE_INSTALL_DISMISSED = "drop_install_dismissed";

const SERVICES = {
  errands: {title:"Town Errands & Delivery", icon:"↗", price:"UGX 5,000 – 10,000", fields:[
    {name:"pickup",label:"PICKUP LOCATION",placeholder:"e.g. Gaagaa Bus Park",required:true},
    {name:"destination",label:"DROP-OFF LOCATION",placeholder:"Where should we deliver?",required:true},
    {name:"itemNote",label:"WHAT ARE WE PICKING UP?",placeholder:"Parcel, groceries, medicine, documents…",required:true}
  ]},
  lawn: {title:"Compound & Lawn Care",icon:"✳",price:"UGX 15,000 – 35,000",fields:[
    {name:"plotSize",label:"CHOOSE YOUR COMPOUND SIZE",type:"radio",options:[["Small Plot","Small Plot — UGX 15,000"],["Medium Compound","Medium Compound — UGX 25,000"],["Large / Custom","Large / Custom — Request a quote"]],required:true}
  ]},
  gas: {title:"Cooking Gas & Heavy Refills",icon:"♨",price:"UGX 7,000 delivery fee",fields:[
    {name:"cylinder",label:"CYLINDER SIZE",type:"radio",options:[["6kg","6kg"],["12kg / 15kg","12kg / 15kg"]],required:true},
    {name:"station",label:"PREFERRED REFILL STATION",type:"radio",options:[["Total","Total"],["Shell","Shell"],["Stabex","Stabex"],["No preference","No preference"]],required:true}
  ]},
  cleaning: {title:"Home & Office Cleaning",icon:"✦",price:"UGX 15,000 – 30,000",fields:[
    {name:"cleaningScope",label:"CHOOSE YOUR CLEANING SCOPE",type:"radio",options:[["Single Room / Quick Clean","Single Room / Quick Clean — UGX 15,000"],["Full House / Half-Day","Full House / Half-Day — UGX 30,000"]],required:true}
  ]},
  handyman: {title:"Quick Fix / Handyman",icon:"⌁",price:"UGX 10,000 call-out",fields:[
    {name:"trade",label:"WHAT KIND OF HELP?",type:"radio",options:[["Plumbing","Plumbing"],["Electrical","Electrical"],["Locks / Carpentry","Locks / Carpentry"]],required:true},
    {name:"issue",label:"BRIEFLY DESCRIBE THE ISSUE",placeholder:"What needs fixing?",required:true}
  ]}
};

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
let selectedService = null;
let gpsPin = null;
let deferredInstallPrompt = null;
let toastTimer = null;

function readJSON(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function getOrders() { return readJSON(STORAGE_ORDERS, []); }
function saveOrders(orders) { saveJSON(STORAGE_ORDERS, orders); }
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
function moneyEstimate(service, details) {
  if (service === "lawn") return details.plotSize === "Small Plot" ? "UGX 15,000" : details.plotSize === "Medium Compound" ? "UGX 25,000" : "Quote required";
  if (service === "cleaning") return details.cleaningScope?.startsWith("Single") ? "UGX 15,000" : details.cleaningScope ? "UGX 30,000" : "UGX 15,000 – 30,000";
  if (service === "gas") return "UGX 7,000 delivery";
  if (service === "handyman") return "UGX 10,000 call-out";
  return "UGX 5,000 – 10,000";
}
function buildServiceFields(serviceKey) {
  const config = SERVICES[serviceKey];
  $("#service-fields").innerHTML = config.fields.map(field => {
    if (field.type === "radio") {
      const cls = field.options.length === 3 ? "choice-grid three" : "choice-grid";
      return `<div class="field-group"><label class="field-label">${field.label}</label><div class="${cls}">${field.options.map((option,i)=>`<label class="choice-pill"><input type="radio" name="${field.name}" value="${escapeHTML(option[0])}" ${i===0?"checked":""} ${field.required?"required":""}><span>${escapeHTML(option[1])}</span></label>`).join("")}</div></div>`;
    }
    return `<div class="field-group"><label class="field-label" for="detail-${field.name}">${field.label}</label><input class="text-input" id="detail-${field.name}" name="${field.name}" placeholder="${escapeHTML(field.placeholder)}" ${field.required?"required":""} maxlength="180"></div>`;
  }).join("");
  updatePriceEstimate();
  $("#service-fields").addEventListener("change", updatePriceEstimate);
  $("#service-fields").addEventListener("input", updatePriceEstimate);
}
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
function collectServiceDetails() {
  const data = {};
  for (const field of SERVICES[selectedService].fields) {
    const selected = $(`[name="${field.name}"]:checked`, $("#service-fields"));
    const input = $(`[name="${field.name}"]`, $("#service-fields"));
    data[field.name] = selected ? selected.value : input?.value?.trim() || "";
  }
  return data;
}
function updatePriceEstimate() {
  if (!selectedService) return;
  $("#price-estimate").textContent = moneyEstimate(selectedService, collectServiceDetails());
}
function openDrawer(serviceKey) {
  selectedService = serviceKey; gpsPin = null;
  const config = SERVICES[serviceKey];
  $$(".service-card").forEach(card => card.classList.toggle("selected", card.dataset.service === serviceKey));
  $("#drawer-title").innerHTML = `Let's get it <em>sorted.</em>`;
  $("#drawer-subtitle").textContent = config.title;
  $("#drawer-service-icon").textContent = config.icon;
  buildServiceFields(serviceKey);
  $("#gps-confirmation").classList.add("hidden");
  $("#drawer-backdrop").classList.remove("hidden"); $("#order-drawer").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const profile = readJSON(STORAGE_PROFILE, {});
  $("#customer-name").value = profile.name || "";
  $("#customer-phone").value = profile.phone || "";
  $("#landmark").value = profile.landmark || "";
  $("#order-drawer").scrollTop = 0;
  setTimeout(() => $("#landmark").focus({preventScroll:true}), 220);
}
function closeDrawer() {
  $("#drawer-backdrop").classList.add("hidden"); $("#order-drawer").classList.add("hidden");
  document.body.style.overflow = ""; $$(".service-card").forEach(card=>card.classList.remove("selected"));
}
function getFormValue(name) { return $(`[name="${name}"]`)?.value?.trim() || ""; }
function createOrderId() {
  const number = Math.floor(100 + Math.random() * 900);
  const datePart = Date.now().toString().slice(-3);
  return `DRP-${number}${datePart}`;
}
function getUrgency() {
  const selected = $('input[name="urgency"]:checked')?.value || "Right Now";
  if (selected === "Schedule") return `Schedule (${getFormValue("scheduleTime") || "time to be agreed"})`;
  return selected;
}
function buildWhatsAppMessage(order) {
  const lines = [
    `*NEW DROP REQUEST: #${order.id}* 🔴`,
    `*Service:* ${order.serviceTitle}`,
    `*Details:* ${order.detailsSummary}`,
    `*When:* ${order.urgency}`,
    `*Customer:* ${order.customerName} (${order.customerPhone})`,
    `*Landmark:* ${order.landmark}`,
    `*GPS Pin:* ${order.gpsUrl || "Not attached"}`,
    "",
    `_Sent via Drop Arua App_`
  ];
  return lines.join("\n");
}
function makeWhatsAppUrl(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
function submitOrder(event) {
  event.preventDefault();
  if (!selectedService) return;
  if (DISPATCH_PHONE.includes("X") || !/^\d{10,15}$/.test(DISPATCH_PHONE)) {
    showToast("Add your WhatsApp dispatch number in app.js first.");
    return;
  }
  const form = $("#order-form");
  if (!form.reportValidity()) return;
  const details = collectServiceDetails();
  const profile = {name:getFormValue("customerName"),phone:getFormValue("customerPhone"),landmark:getFormValue("landmark")};
  saveJSON(STORAGE_PROFILE, profile);
  const order = {
    id:createOrderId(), serviceKey:selectedService, serviceTitle:SERVICES[selectedService].title,
    details, detailsSummary:formatDetails(selectedService, details),
    urgency:getUrgency(), customerName:profile.name, customerPhone:profile.phone,
    landmark:profile.landmark, gpsUrl:gpsPin ? `https://www.google.com/maps?q=${gpsPin.lat},${gpsPin.lng}` : "",
    status:"sent", runnerName:"", runnerPhone:"",
    createdAt:new Date().toISOString(), estimate:moneyEstimate(selectedService, details)
  };
  const orders = getOrders(); orders.unshift(order); saveOrders(orders);
  renderOrders(); updateOrderCount();
  const url = makeWhatsAppUrl(DISPATCH_PHONE, buildWhatsAppMessage(order));
  closeDrawer();
  window.location.href = url;
}
function formatDetails(key, details) {
  const values = Object.values(details).filter(Boolean);
  if (key === "lawn" || key === "cleaning") return `${values.join(" · ")} (${moneyEstimate(key,details)})`;
  if (key === "gas") return `${details.cylinder} cylinder · ${details.station} station · UGX 7,000 delivery`;
  if (key === "handyman") return `${details.trade}: ${details.issue} (UGX 10,000 call-out)`;
  return `Pickup: ${details.pickup} · Drop-off: ${details.destination} · Item: ${details.itemNote}`;
}
async function attachGPS() {
  if (!navigator.geolocation) return showToast("GPS is not supported by this browser.");
  const button = $("#gps-button"); button.disabled = true; button.textContent = "Getting your location…";
  navigator.geolocation.getCurrentPosition(position => {
    gpsPin = {lat:position.coords.latitude,lng:position.coords.longitude};
    $("#gps-confirmation").classList.remove("hidden");
    button.textContent = "⌖ GPS pin attached"; button.classList.add("hidden");
    showToast("GPS pin attached to your request.");
  }, error => {
    button.disabled = false; button.innerHTML = "<span>⌖</span> Try attaching GPS pin";
    const message = error.code === 1 ? "Allow location access to attach your GPS pin." : "Couldn't get your location. Add a landmark instead.";
    showToast(message);
  }, {enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}
function removeGPS() {
  gpsPin = null; $("#gps-confirmation").classList.add("hidden"); $("#gps-button").classList.remove("hidden");
  $("#gps-button").disabled = false; $("#gps-button").innerHTML = "<span>⌖</span> Attach my GPS pin";
}
const STATUS = {
  sent:{label:"Request Sent",step:1,percent:25},
  assigned:{label:"Runner Assigned",step:2,percent:50},
  progress:{label:"In Progress",step:3,percent:75},
  completed:{label:"Completed",step:4,percent:100}
};
function syncStatusFromURL() {
  const params = new URLSearchParams(window.location.search);
  const orderId = (params.get("order") || "").replace(/^#/, "").toUpperCase();
  const status = (params.get("status") || "").toLowerCase();
  if (!orderId || !STATUS[status]) return false;
  const orders = getOrders(); const index = orders.findIndex(order=>order.id.toUpperCase()===orderId);
  if (index < 0) return false;
  orders[index].status = status;
  if (params.get("runner")) orders[index].runnerName = params.get("runner").slice(0,70);
  if (params.get("runnerPhone")) orders[index].runnerPhone = params.get("runnerPhone").slice(0,20);
  orders[index].updatedAt = new Date().toISOString();
  saveOrders(orders);
  // Remove update parameters from the address bar after applying the update.
  history.replaceState({}, "", window.location.pathname + window.location.hash);
  return true;
}
function renderOrders() {
  const orders = getOrders(), list = $("#orders-list");
  $("#empty-state").classList.toggle("hidden", orders.length > 0);
  list.classList.toggle("hidden", orders.length === 0);
  $("#tracker-summary").innerHTML = orders.length ? `<div class="summary-chip"><strong>${orders.length}</strong> total ${orders.length===1?"drop":"drops"}</div><div class="summary-chip"><strong>${orders.filter(o=>o.status!=="completed").length}</strong> active</div><div class="summary-chip"><strong>${orders.filter(o=>o.status==="completed").length}</strong> completed</div>` : "";
  list.innerHTML = orders.map(order => {
    const state = STATUS[order.status] || STATUS.sent;
    const labels = ["Request Sent","Runner Assigned","In Progress","Completed"];
    const runner = order.runnerName ? `<div class="runner-card"><div><strong>Your Runner: ${escapeHTML(order.runnerName)}</strong><small>${escapeHTML(order.runnerPhone || "Contact number not provided")}</small></div>${order.runnerPhone?`<a class="call-runner" href="tel:${escapeHTML(order.runnerPhone.replace(/[^+\d]/g,""))}">Call runner ↗</a>`:""}</div>` : "";
    const gps = order.gpsUrl ? `<a class="secondary-button" href="${escapeHTML(order.gpsUrl)}" target="_blank" rel="noopener">View location pin ↗</a>` : "";
    return `<article class="order-card"><div class="order-card-top"><div><div class="order-id">#${escapeHTML(order.id)}</div><div class="order-date">${new Date(order.createdAt).toLocaleString("en-UG",{dateStyle:"medium",timeStyle:"short"})}</div></div><span class="status-pill ${order.status==="completed"?"completed":""}">${state.label}</span></div><h3 class="order-service">${escapeHTML(order.serviceTitle)}</h3><p class="order-detail">${escapeHTML(order.detailsSummary)}<br>For ${escapeHTML(order.customerName)} · ${escapeHTML(order.landmark)}</p><div class="progress-track"><div class="progress-fill ${order.status==="completed"?"completed":""}" style="width:${state.percent}%"></div></div><div class="progress-labels">${labels.map((label,i)=>`<span class="${i<state.step?"done":""}">${label}</span>`).join("")}</div>${runner}<div class="order-actions"><a class="secondary-button" href="${makeWhatsAppUrl(DISPATCH_PHONE,`Hi Drop, checking status for Order #${order.id}`)}" target="_blank" rel="noopener">Ping dispatch on WhatsApp ↗</a>${gps}</div></article>`;
  }).join("");
}
function updateOrderCount() {
  const count = getOrders().length, badge = $("#order-count");
  badge.textContent = count; badge.classList.toggle("hidden", count===0);
}
function switchTab(tab) {
  const orders = tab === "orders";
  $("#new-drop-view").classList.toggle("hidden",orders); $("#my-drops-view").classList.toggle("hidden",!orders);
  $$(".nav-item").forEach(item=>item.classList.toggle("active",item.dataset.tab===(orders?"orders":"new")));
  if (orders) renderOrders();
  window.scrollTo({top:0,behavior:"smooth"});
}
function setupInstallPrompt() {
  const dismissed = localStorage.getItem(STORAGE_INSTALL_DISMISSED)==="1";
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (isIOS && !window.navigator.standalone && !dismissed) $("#ios-hint").classList.remove("hidden");
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); deferredInstallPrompt = event;
    if (!dismissed) $("#install-banner").classList.remove("hidden");
  });
  $("#install-button").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null; $("#install-banner").classList.add("hidden");
  });
  $("#dismiss-install").addEventListener("click", () => {
    localStorage.setItem(STORAGE_INSTALL_DISMISSED,"1"); $("#install-banner").classList.add("hidden"); $("#ios-hint").classList.add("hidden");
  });
  window.addEventListener("appinstalled",()=>$("#install-banner").classList.add("hidden"));
}
function init() {
  const updated = syncStatusFromURL();
  $$(".service-card").forEach(card=>card.addEventListener("click",()=>openDrawer(card.dataset.service)));
  $$(".nav-item").forEach(item=>item.addEventListener("click",()=>switchTab(item.dataset.tab)));
  $("#close-drawer").addEventListener("click",closeDrawer);
  $("#drawer-backdrop").addEventListener("click",closeDrawer);
  $("#order-form").addEventListener("submit",submitOrder);
  $("#gps-button").addEventListener("click",attachGPS);
  $("#remove-gps").addEventListener("click",removeGPS);
  $$('input[name="urgency"]').forEach(input=>input.addEventListener("change",()=>{
    $("#schedule-fields").classList.toggle("hidden",input.value!=="Schedule" || !input.checked);
    $("#schedule-time").required = input.value==="Schedule" && input.checked;
  }));
  $("#empty-order-button").addEventListener("click",()=>switchTab("new"));
  $("#customer-phone").addEventListener("blur",()=>{const p=$("#customer-phone");if(p.value && !/^[+()\d\s-]{7,20}$/.test(p.value))p.setCustomValidity("Enter a valid phone number.");else p.setCustomValidity("");});
  updateOrderCount(); renderOrders(); setupInstallPrompt();
  if (updated) { switchTab("orders"); showToast("Your order status has been updated."); }
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(err=>console.warn("Service worker registration failed:",err)));
  }
}
document.addEventListener("DOMContentLoaded",init);
