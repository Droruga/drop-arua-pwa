/* Drop — lightweight, client-side PWA.
   Set DISPATCH_PHONE to your WhatsApp number in international format, digits only.
   Uganda example: 256772000000 (no +, spaces or leading 0).

   Business logic (services, pricing, order records, WhatsApp payload, order IDs
   and local storage) is kept separate from presentation helpers. */
const DISPATCH_PHONE = "256702964822";
const STORAGE_ORDERS = "drop_orders";
const STORAGE_PROFILE = "drop_customer";
const STORAGE_INSTALL_DISMISSED = "drop_install_dismissed";
const STORAGE_WELCOMED = "drop_welcomed";
const STORAGE_CITY = "drop_city";
const STORAGE_CART = "drop_catalogue_cart";
const STORAGE_CHECKOUT = "drop_checkout_v1";

const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let deferredInstallPrompt = null;
let toastTimer = null;
let selectedCity = localStorage.getItem(STORAGE_CITY) || "Mbarara";

/* ------------------------------------------------------------------ storage */
function readJSON(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
const STORAGE_HISTORY = "drop_history_v1";
function getOrders() {
  const current = readJSON(STORAGE_HISTORY, null);
  if (Array.isArray(current)) return current.slice(0,50);
  const legacy = readJSON(STORAGE_ORDERS, []);
  const migrated = Array.isArray(legacy) ? legacy.slice(0,50) : [];
  saveJSON(STORAGE_HISTORY, migrated);
  return migrated;
}
function saveOrders(orders) {
  const latest = (Array.isArray(orders) ? orders : []).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,50);
  saveJSON(STORAGE_HISTORY, latest);
}

/* -------------------------------------------------------------------- toast */
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => { toast.hidden = true; }, 240);
  }, 3000);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}

function makeWhatsAppUrl(phone, message) {
  return "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);
}

function formatOrderDate(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"Date unavailable":date.toLocaleString("en-UG",{dateStyle:"medium",timeStyle:"short"});
}
function formatOrderRange(min,max) {
  const low=Number(min)||0,high=Number(max)||0;
  return low===high?catalogMoney(low):catalogMoney(low)+" – "+catalogMoney(high);
}
function renderOrders() {
  const orders=getOrders().sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,50);
  const list=$("#orders-list");
  const hasOrders=orders.length>0;
  $("#empty-state").hidden=hasOrders;
  list.hidden=!hasOrders;
  $("#tracker-summary").hidden=true;
  $("#tracker-summary").innerHTML="";
  if(!hasOrders){list.innerHTML="";return;}
  list.innerHTML=orders.map(order=>{
    const items=Array.isArray(order.items)?order.items:[];
    const itemSummary=items.length?items.map(item=>escapeHTML(item.name)+" × "+Number(item.quantity||1)).join(", "):escapeHTML(order.detailsSummary||order.serviceTitle||"Drop order");
    const total=order.totalMin!=null?formatOrderRange(order.totalMin,order.totalMax):escapeHTML(order.estimate||"To be confirmed");
    const itemRows=items.map(item=>'<li><span>'+escapeHTML(item.name)+' · '+escapeHTML(item.unit||"")+' × '+Number(item.quantity||1)+'</span><strong>'+formatOrderRange(Number(item.price_min)*Number(item.quantity||1),Number(item.price_max)*Number(item.quantity||1))+'</strong></li>').join("");
    const details=items.length
      ? '<ul class="history-item-list">'+itemRows+'</ul><p><strong>Items estimate:</strong> '+total+' + delivery fee to confirm</p>'
      : '<p>'+escapeHTML(order.detailsSummary||"")+'</p>';
    const location=order.location||order.landmark||"";
    const recipient=order.name||order.recipientName||order.customerName||"";
    const phone=order.phone||order.recipientPhone||order.customerPhone||"";
    const when=order.timing==="Scheduled"?(order.date+" at "+order.time):(order.timing||order.urgency||"ASAP");
    const gps=order.gps?'<a href="https://www.google.com/maps?q='+encodeURIComponent(order.gps.lat+","+order.gps.lng)+'" target="_blank" rel="noopener">View delivery pin</a>':(order.gpsUrl?'<a href="'+escapeHTML(order.gpsUrl)+'" target="_blank" rel="noopener">View delivery pin</a>':"Not attached");
    return '<details class="order-card order-history-card history-order"><summary class="history-order-summary"><span class="history-order-main"><strong class="order-ref">#'+escapeHTML(order.id||"Drop order")+'</strong><span class="order-date">'+escapeHTML(formatOrderDate(order.createdAt))+'</span><span class="history-order-items">'+itemSummary+'</span></span><span class="history-order-total">'+total+'<span class="history-expand-label">View details</span></span></summary><div class="history-order-details">'+details+
      '<dl class="history-detail-grid"><div><dt>Delivery area</dt><dd>'+escapeHTML(location||"Not supplied")+'</dd></div><div><dt>Landmark</dt><dd>'+escapeHTML(order.landmark||"Not supplied")+'</dd></div><div><dt>Contact</dt><dd>'+escapeHTML(recipient||"Not supplied")+' · '+escapeHTML(phone||"")+'</dd></div><div><dt>When</dt><dd>'+escapeHTML(when)+'</dd></div><div><dt>Payment</dt><dd>'+escapeHTML(order.payment||order.paymentMethod||"Not selected")+'</dd></div><div><dt>GPS</dt><dd>'+gps+'</dd></div></dl>'+
      (order.notes||order.deliveryNotes?'<p><strong>Notes:</strong> '+escapeHTML(order.notes||order.deliveryNotes)+'</p>':"")+
      (order.ageConfirmed?'<p>Customer confirmed age 18+.</p>':"")+(order.rxAcknowledged?'<p>Prescription requirement acknowledged.</p>':"")+
      (order.serviceTitle?'<p><strong>Original request:</strong> '+escapeHTML(order.serviceTitle)+'</p>':"")+
      '</div></details>';
  }).join("");
}
function updateOrderCount() {
  const count = getOrders().length;
  const badge = $("#order-count");
  if (badge) { badge.textContent = count; badge.hidden = count === 0; }
}

/* ------------------------------------------------------------- navigation */
/* ----------------------------------------------------------- product catalog */
let dropCatalogData = null;
let activeCatalogCategory = null;
const CATEGORY_ICON_KEYS = {
  groceries:"i-basket", convenience:"i-store", alcohol:"i-wine",
  food:"i-utensils", household:"i-home", health:"i-heart", retail:"i-bag"
};
const SUBCATEGORY_ICON_KEYS = {
  grains:"i-basket", carrot:"i-basket", fish:"i-basket", bread:"i-basket",
  "cooking-pot":"i-basket", cookie:"i-basket", storefront:"i-store"
};
function catalogMoney(value) {
  return "UGX " + Number(value).toLocaleString("en-UG");
}
function catalogPrice(product) {
  const low = catalogMoney(product.price_min);
  const high = catalogMoney(product.price_max);
  return product.price_min === product.price_max ? low : low + " – " + high;
}
function availabilityLabel(value) {
  return ({in_stock:"In stock",seasonal:"Seasonal — confirm on day",order_in:"Order in — confirm availability",out_of_stock:"Out of stock"})[value] || "Check availability";
}
function catalogProductRow(product) {
  const unavailable = product.availability === "out_of_stock";
  const safeId = escapeHTML(product.id);
  const note = product.price_note || product.notes || "";
  return '<article class="catalog-product" data-product-id="' + safeId + '">' +
    '<div class="catalog-product-main"><h3>' + escapeHTML(product.name) + '</h3>' +
    '<p class="catalog-product-unit">' + escapeHTML(product.unit) + '</p>' +
    '<p class="catalog-product-price">' + catalogPrice(product) + '</p>' +
    (note ? '<p class="catalog-product-note">' + escapeHTML(note) + '</p>' : '') +
    '<span class="catalog-availability availability-' + product.availability + '">' + availabilityLabel(product.availability) + '</span>' +
    (product.age_restricted ? '<span class="catalog-product-flag">18+</span>' : '') +
    (product.rx_required ? '<span class="catalog-product-flag catalog-product-flag--rx">Rx</span>' : '') +
    '</div><button class="catalog-add-button" type="button" data-add-product="' + safeId + '"' +
    (unavailable ? ' disabled aria-label="Out of stock"' : ' aria-label="Add ' + escapeHTML(product.name) + ' to cart"') +
    '><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg><span>' + (unavailable ? "Unavailable" : "Add") + '</span></button></article>';
}
function renderCatalogCategory(categoryId, scrollToSubcategory) {
  if (!dropCatalogData) return;
  const category = dropCatalogData.categories.find(item => item.id === categoryId);
  if (!category) return;
  activeCatalogCategory = categoryId;
  $("#category-title").textContent = category.name;
  $("#category-description").textContent = category.description || "Browse products in this category.";
  const chips = category.subcategories.map((sub,index) =>
    '<a class="subcategory-chip' + (index === 0 ? ' is-active' : '') + '" href="#subcategory-' + escapeHTML(sub.id) + '" data-subcategory-chip="' + escapeHTML(sub.id) + '">' + escapeHTML(sub.name) + '</a>'
  ).join("");
  const groups = category.subcategories.map((sub,index) =>
    '<section class="catalog-subcategory" id="subcategory-' + escapeHTML(sub.id) + '">' +
    '<div class="catalog-subcategory-heading"><span class="catalog-subcategory-icon"><svg class="icon"><use href="#' + (SUBCATEGORY_ICON_KEYS[sub.icon] || "i-basket") + '"/></svg></span>' +
    '<div><h2>' + escapeHTML(sub.name) + '</h2><p>' + sub.products.length + ' items</p></div></div>' +
    '<div class="catalog-product-list">' + (sub.products.length ? sub.products.map(catalogProductRow).join("") : '<p class="catalog-empty-subcategory">Products will be added here.</p>') + '</div></section>'
  ).join("");
  $("#category-content").innerHTML =
    '<nav class="subcategory-nav" aria-label="Browse subcategories">' + chips + '</nav>' +
    '<div class="catalog-subcategory-list">' + groups + '</div>';
  if (scrollToSubcategory) {
    const target = document.getElementById("subcategory-" + scrollToSubcategory);
    if (target) target.scrollIntoView({behavior:reduceMotion ? "auto" : "smooth",block:"start"});
  }
}
function openCategory(id) {
  if (!dropCatalogData) {
    showToast("The product catalogue is not ready yet. Please try again shortly.");
    return;
  }
  switchTab("category");
  renderCatalogCategory(id);
}
function renderCatalogSearch(query) {
  const panel = $("#catalog-search-results");
  const term = query.trim().toLocaleLowerCase();
  if (!term || !dropCatalogData) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const matches = [];
  dropCatalogData.categories.forEach(category => category.subcategories.forEach(sub => sub.products.forEach(product => {
    if ((product.name + " " + sub.name + " " + category.name).toLocaleLowerCase().includes(term)) {
      matches.push({category,sub,product});
    }
  })));
  panel.hidden = false;
  panel.innerHTML = matches.length
    ? '<p class="catalog-search-count">' + matches.length + ' matching products</p>' + matches.slice(0,40).map(match =>
      '<button class="catalog-search-result" type="button" data-search-category="' + escapeHTML(match.category.id) + '" data-search-subcategory="' + escapeHTML(match.sub.id) + '"><span><strong>' + escapeHTML(match.product.name) + '</strong><small>' + escapeHTML(match.sub.name) + ' · ' + escapeHTML(match.category.name) + '</small></span><span class="catalog-search-price">' + catalogPrice(match.product) + '</span></button>'
    ).join("")
    : '<p class="catalog-search-empty">No products found. Try another name or category.</p>';
}
function addCatalogProduct(productId) {
  if (!dropCatalogData) return;
  const product = dropCatalogData.categories.flatMap(category => category.subcategories.flatMap(sub => sub.products)).find(item => item.id === productId);
  if (!product || product.availability === "out_of_stock") return;
  const cart = readJSON(STORAGE_CART, []);
  const existing = cart.find(item => item.productId === productId);
  if (existing) existing.quantity = Math.max(1, Number(existing.quantity) || 1) + 1;
  else cart.push({productId:product.id,quantity:1,product:product});
  saveJSON(STORAGE_CART, cart);
  renderCart();
  showToast(product.name + " added to your cart.");
}
async function setupProductCatalog() {
  const panel = $("#category-content");
  try {
    dropCatalogData = await window.DropCatalog.load();
    const versionDate = new Date(dropCatalogData.version + "T00:00:00");
    $("#catalog-version").textContent = "Catalogue updated " + versionDate.toLocaleDateString("en-UG", {day:"numeric", month:"short", year:"numeric"});
    $("#category-grid").innerHTML = dropCatalogData.categories.map(category =>
      '<button class="category-card category-card--' + escapeHTML(category.id) + '" type="button" data-category="' + escapeHTML(category.id) + '">' +
      '<span class="category-icon"><svg class="icon"><use href="#' + (CATEGORY_ICON_KEYS[category.id] || "i-basket") + '"/></svg></span>' +
      '<span class="category-name">' + escapeHTML(category.name) + '</span>' +
      '<span class="category-meta">' + category.subcategories.length + ' subcategories</span>' +
      '<svg class="category-arrow icon"><use href="#i-chevron-right"/></svg></button>'
    ).join("");
    $(".category-card").forEach(card => card.addEventListener("click", () => openCategory(card.dataset.category)));
    $("#category-content").innerHTML = '<p class="catalog-empty-subcategory">Choose a category to browse its products.</p>';
    renderCart();
  } catch (error) {
    if (panel) panel.innerHTML = '<div class="catalog-error" role="alert"><strong>We couldn’t load the catalogue.</strong><p>' + escapeHTML(error.message) + '</p><button class="pill-button" type="button" id="catalog-retry">Try again</button></div>';
    $("#catalog-retry")?.addEventListener("click", setupProductCatalog);
    $("#category-grid").innerHTML = '<div class="catalog-error" role="alert">The product catalogue is temporarily unavailable.</div>';
  }
}

function switchTab(tab) {
  const orders = tab === "orders";
  const cart = tab === "cart";
  const category = tab === "category";
  const checkout = tab === "checkout";
  $("#new-drop-view").hidden = orders || cart || category || checkout;
  $("#category-view").hidden = !category;
  $("#my-drops-view").hidden = !orders;
  $("#cart-view").hidden = !cart;
  $("#checkout-view").hidden = !checkout;
  if (checkout) prepareCheckout();
  if (orders) renderOrders();
  if (cart) renderCart();
  window.scrollTo({top:0, behavior: reduceMotion ? "auto" : "smooth"});
}
function getCart() {
  const stored = readJSON(STORAGE_CART, []);
  if (!Array.isArray(stored)) return [];
  const normalized = stored.map(item => ({
    productId: String(item.productId || item.product?.id || item.itemId || ""),
    quantity: Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1)))
  })).filter(item => item.productId);
  if (JSON.stringify(stored) !== JSON.stringify(normalized)) saveJSON(STORAGE_CART, normalized);
  return normalized;
}
function findCatalogProduct(productId) {
  if (!dropCatalogData) return null;
  for (const category of dropCatalogData.categories) {
    for (const subcategory of category.subcategories) {
      const product = subcategory.products.find(item => item.id === productId);
      if (product) return product;
    }
  }
  return null;
}
function cartTotals(items) {
  return items.reduce((totals, item) => {
    const product = findCatalogProduct(item.productId);
    if (!product) return totals;
    totals.min += product.price_min * item.quantity;
    totals.max += product.price_max * item.quantity;
    return totals;
  }, {min:0,max:0});
}
function getCheckoutData() {
  const saved = readJSON(STORAGE_CHECKOUT, {});
  const profile = readJSON(STORAGE_PROFILE, {});
  return {
    location: saved.location || profile.address || "",
    landmark: saved.landmark || profile.landmark || "",
    name: saved.name || profile.name || "",
    phone: saved.phone || profile.phone || "",
    timing: saved.timing || "ASAP",
    date: saved.date || "",
    time: saved.time || "",
    payment: saved.payment || "",
    notes: saved.notes || "",
    gps: saved.gps || null,
    ageConfirmed: Boolean(saved.ageConfirmed),
    rxAcknowledged: Boolean(saved.rxAcknowledged)
  };
}
function checkoutCartProducts() {
  return getCart().map(item => ({...item, product:findCatalogProduct(item.productId)})).filter(item => item.product);
}
function prepareCheckout() {
  const form=$("#checkout-form");
  if(!form)return;
  const data=getCheckoutData();
  ["location","landmark","name","phone","date","time","notes"].forEach(key=>{
    const field=form.elements.namedItem(key);
    if(field)field.value=data[key]||"";
  });
  const timing=form.querySelector('[name="timing"][value="'+data.timing+'"]');
  if(timing)timing.checked=true;
  const payment=form.querySelector('[name="payment"][value="'+data.payment+'"]');
  if(payment)payment.checked=true;
  $("#checkout-schedule-fields").hidden=data.timing!=="Scheduled";
  $("#checkout-date").required=data.timing==="Scheduled";
  $("#checkout-time").required=data.timing==="Scheduled";
  const products=checkoutCartProducts();
  const ageRequired=products.some(item=>item.product.age_restricted);
  const rxRequired=products.some(item=>item.product.rx_required);
  $("#checkout-restrictions").hidden=!(ageRequired||rxRequired);
  $("#checkout-age-wrap").hidden=!ageRequired;
  $("#checkout-rx-wrap").hidden=!rxRequired;
  $("#checkout-age").checked=data.ageConfirmed;
  $("#checkout-rx").checked=data.rxAcknowledged;
  renderCheckoutEstimate();
  renderCheckoutGPS(data.gps);
  $("#checkout-form").hidden=false;
  $("#checkout-saved").hidden=true;
  const now=new Date();
  const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
  $("#checkout-date").min=today;
}
function renderCheckoutEstimate() {
  const products=checkoutCartProducts();
  const totals=cartTotals(products);
  const count=products.reduce((sum,item)=>sum+item.quantity,0);
  const fmt=(a,b)=>a===b?catalogMoney(a):catalogMoney(a)+" – "+catalogMoney(b);
  $("#checkout-estimate").innerHTML='<div><span>Items ('+count+')</span><strong>'+fmt(totals.min,totals.max)+'</strong></div><div><span>Delivery fee</span><strong>Confirm on WhatsApp</strong></div><p>Estimated only. Final prices and availability will be confirmed before dispatch.</p>';
}
function renderCheckoutGPS(gps) {
  const status=$("#checkout-gps-status");
  const remove=$("#checkout-remove-gps");
  status.textContent=gps?"GPS pin attached":"GPS pin is optional";
  remove.hidden=!gps;
}
function requestCheckoutGPS() {
  if(!navigator.geolocation){showToast("GPS is not supported on this device.");return;}
  const button=$("#checkout-gps");
  button.disabled=true;
  button.textContent="Getting location…";
  navigator.geolocation.getCurrentPosition(position=>{
    const data=getCheckoutData();
    data.gps={lat:position.coords.latitude,lng:position.coords.longitude};
    saveJSON(STORAGE_CHECKOUT,data);
    renderCheckoutGPS(data.gps);
    button.disabled=false;
    button.innerHTML='<svg class="icon"><use href="#i-pin"/></svg> Update GPS pin';
    showToast("Delivery GPS pin attached.");
  },error=>{
    button.disabled=false;
    button.innerHTML='<svg class="icon"><use href="#i-pin"/></svg> Add GPS pin';
    showToast(error.code===1?"Allow location access to attach a pin.":"Could not get GPS. Please enter a landmark.");
  },{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
}
function createCatalogOrderId() {
  const now=new Date();
  const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("");
  const existing=new Set(getOrders().map(order=>order.id));
  let id;
  do{id="ORD-"+date+"-"+String(Math.floor(100+Math.random()*900));}while(existing.has(id));
  return id;
}
function buildCatalogWhatsAppMessage(order) {
  const lines=[
    "*NEW DROP ORDER · #"+order.id+"*",
    "",
    "*CUSTOMER:* "+order.name,
    "*PHONE:* "+order.phone,
    "*DELIVERY LOCATION:* "+order.location,
    "*LANDMARK:* "+order.landmark,
    "*GPS PIN:* "+(order.gps?"https://www.google.com/maps?q="+order.gps.lat+","+order.gps.lng:"Not attached"),
    "*WHEN:* "+(order.timing==="Scheduled"?order.date+" at "+order.time:"ASAP"),
    "*PAYMENT:* "+order.payment,
    "*NOTES:* "+(order.notes||"None"),
    "",
    "*ORDER ITEMS*"
  ];
  order.items.forEach((item,index)=>{
    lines.push((index+1)+". "+item.name+" · "+item.unit+" · Qty "+item.quantity);
    lines.push("   "+formatOrderRange(item.price_min,item.price_max)+" each");
    lines.push("   Line estimate: "+formatOrderRange(item.price_min*item.quantity,item.price_max*item.quantity));
  });
  lines.push("","*ITEMS ESTIMATE:* "+formatOrderRange(order.totalMin,order.totalMax));
  lines.push("*DELIVERY FEE:* To be confirmed by Drop");
  lines.push("*ESTIMATED TOTAL:* "+formatOrderRange(order.totalMin,order.totalMax)+" + delivery fee");
  if(order.ageRestricted)lines.push("","*AGE RESTRICTION:* Customer confirms they are 18+.");
  if(order.rxRequired)lines.push("*PRESCRIPTION:* Customer acknowledges a valid prescription may be requested.");
  lines.push("","Reply CONFIRM to accept.");
  return lines.join("\n");
}
function openCatalogWhatsApp() {
  const order=readJSON("drop_last_order_v1",null);
  if(!order||!order.whatsappMessage){showToast("No saved order message found.");return;}
  if(!/^\\d{10,15}$/.test(DISPATCH_PHONE)){showToast("Drop dispatch number is not configured.");return;}
  window.location.href=makeWhatsAppUrl(DISPATCH_PHONE,order.whatsappMessage);
}
async function copyCatalogWhatsAppMessage() {
  const order=readJSON("drop_last_order_v1",null);
  if(!order||!order.whatsappMessage){showToast("No order message to copy.");return;}
  try{
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(order.whatsappMessage);
    else{
      const field=document.createElement("textarea");field.value=order.whatsappMessage;field.setAttribute("readonly","");
      field.style.position="fixed";field.style.opacity="0";document.body.appendChild(field);field.select();
      const copied=document.execCommand("copy");field.remove();if(!copied)throw new Error("Copy unavailable");
    }
    showToast("Complete order message copied.");
  }catch(error){showToast("Copy failed. Select and copy the message shown above.");}
}
function saveCheckout(event) {
  event.preventDefault();
  const form=$("#checkout-form");
  const phone=form.elements.phone.value.trim();
  if(!form.elements.location.value.trim()||!form.elements.landmark.value.trim()||!form.elements.name.value.trim()||!phone){
    showToast("Please complete your delivery address and contact details.");return;
  }
  if(!PHONE_PATTERN.test(phone)){showToast("Enter a valid contact phone number.");form.elements.phone.focus();return;}
  const timing=form.elements.timing.value;
  if(timing==="Scheduled"){
    const date=form.elements.date.value,time=form.elements.time.value;
    if(!date||!time){showToast("Choose your delivery date and preferred time.");return;}
    const selected=new Date(date+"T"+time);
    if(Number.isNaN(selected.getTime())||selected.getTime()<Date.now()){showToast("Choose a future delivery time.");return;}
  }
  const payment=form.elements.payment.value;
  if(!payment){showToast("Choose a payment method.");return;}
  const products=checkoutCartProducts();
  if(!products.length){showToast("Your cart is empty. Add products before checkout.");switchTab("cart");return;}
  const ageRequired=products.some(item=>item.product.age_restricted);
  const rxRequired=products.some(item=>item.product.rx_required);
  if(ageRequired&&!$("#checkout-age").checked){showToast("Please confirm you are 18 or older.");return;}
  if(rxRequired&&!$("#checkout-rx").checked){showToast("Please acknowledge the prescription requirement.");return;}
  if(!/^\\d{10,15}$/.test(DISPATCH_PHONE)){showToast("Drop dispatch number is not configured.");return;}
  const previous=getCheckoutData();
  const data={
    id:createCatalogOrderId(),
    location:form.elements.location.value.trim(),landmark:form.elements.landmark.value.trim(),
    name:form.elements.name.value.trim(),phone,timing,
    date:timing==="Scheduled"?form.elements.date.value:"",
    time:timing==="Scheduled"?form.elements.time.value:"",
    payment,notes:form.elements.notes.value.trim(),gps:previous.gps,
    ageConfirmed:ageRequired&&$("#checkout-age").checked,
    rxAcknowledged:rxRequired&&$("#checkout-rx").checked,
    ageRestricted:ageRequired,rxRequired,
    items:products.map(item=>({
      id:item.product.id,name:item.product.name,unit:item.product.unit,quantity:item.quantity,
      price_min:item.product.price_min,price_max:item.product.price_max,
      price_note:item.product.price_note||"",age_restricted:Boolean(item.product.age_restricted),rx_required:Boolean(item.product.rx_required)
    })),
    totalMin:cartTotals(products).min,totalMax:cartTotals(products).max,
    createdAt:new Date().toISOString()
  };
  data.whatsappMessage=buildCatalogWhatsAppMessage(data);
  const orders=getOrders();orders.unshift(data);saveOrders(orders);
  saveJSON("drop_last_order_v1",data);
  saveJSON(STORAGE_CHECKOUT,{...data,whatsappMessage:undefined});
  saveJSON(STORAGE_PROFILE,{...readJSON(STORAGE_PROFILE,{}),name:data.name,phone:data.phone,landmark:data.landmark,address:data.location});
  saveJSON(STORAGE_CART,[]);
  renderCart();updateOrderCount();renderOrders();
  $("#checkout-form").hidden=true;
  $("#checkout-saved").hidden=false;
  $("#checkout-confirmation-title").textContent="Order "+data.id+" is ready";
  $("#checkout-confirmation-copy").textContent="Your order has been saved on this device. WhatsApp should open with the complete order message. If it doesn’t, use the options below.";
  $("#whatsapp-message").textContent=data.whatsappMessage;
  $("#whatsapp-handoff").hidden=false;
  $("#checkout-saved").scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"start"});
  window.location.href=makeWhatsAppUrl(DISPATCH_PHONE,data.whatsappMessage);
}
function renderCart() {
  const items = getCart();
  const badge = $("#cart-count");
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
  if (!dropCatalogData) {
    $("#cart-empty").hidden = count > 0;
    $("#cart-items").hidden = true;
    return;
  }
  const validItems = items.map(item => ({...item, product:findCatalogProduct(item.productId)})).filter(item => item.product);
  if (validItems.length !== items.length) {
    saveJSON(STORAGE_CART, validItems.map(item => ({productId:item.productId,quantity:item.quantity})));
  }
  $("#cart-empty").hidden = validItems.length > 0;
  const container = $("#cart-items");
  container.hidden = validItems.length === 0;
  if (!validItems.length) { container.innerHTML = ""; return; }
  const totals = cartTotals(validItems);
  container.innerHTML =
    '<div class="cart-line-list">' + validItems.map(item => {
      const product = item.product;
      const lineMin = product.price_min * item.quantity;
      const lineMax = product.price_max * item.quantity;
      return '<article class="cart-line" data-cart-product="' + escapeHTML(product.id) + '">' +
        '<div class="cart-line-copy"><h2>' + escapeHTML(product.name) + '</h2>' +
        '<p>' + escapeHTML(product.unit) + ' · ' + catalogPrice(product) + ' each</p>' +
        '<strong class="cart-line-total">' + (lineMin === lineMax ? catalogMoney(lineMin) : catalogMoney(lineMin) + ' – ' + catalogMoney(lineMax)) + '</strong>' +
        (product.age_restricted ? '<span class="catalog-product-flag">18+</span>' : '') +
        (product.rx_required ? '<span class="catalog-product-flag catalog-product-flag--rx">Prescription required</span>' : '') +
        '</div><div class="cart-line-actions"><div class="quantity-control" role="group" aria-label="Quantity for ' + escapeHTML(product.name) + '">' +
        '<button type="button" data-cart-decrease="' + escapeHTML(product.id) + '" aria-label="Decrease quantity">−</button>' +
        '<output aria-live="polite">' + item.quantity + '</output>' +
        '<button type="button" data-cart-increase="' + escapeHTML(product.id) + '" aria-label="Increase quantity">+</button></div>' +
        '<button type="button" class="cart-remove" data-cart-remove="' + escapeHTML(product.id) + '">Remove</button></div></article>';
    }).join("") + '</div>' +
    '<section class="cart-summary" aria-label="Cart estimate"><div><span>Items (' + count + ')</span><strong>' +
    (totals.min === totals.max ? catalogMoney(totals.min) : catalogMoney(totals.min) + ' – ' + catalogMoney(totals.max)) +
    '</strong></div><div><span>Delivery fee</span><strong>Confirm on WhatsApp</strong></div><div class="cart-grand-total"><span>Estimated total</span><strong>' +
    (totals.min === totals.max ? catalogMoney(totals.min) : catalogMoney(totals.min) + ' – ' + catalogMoney(totals.max)) +
    ' + delivery</strong></div><p>Prices are estimates. Drop will confirm final prices, availability and delivery fee before dispatch.</p></section>' +
    '<div class="cart-footer-actions"><button class="secondary-button cart-continue" type="button" id="cart-continue-shopping">Continue shopping</button><button class="primary-button cart-checkout" type="button" id="cart-checkout">Continue to checkout <svg class="icon"><use href="#i-arrow-right"/></svg></button></div>';
}


/* ------------------------------------------------------------ installation */
function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function setupInstallPrompt() {
  const panel = $("#install-panel");
  const button = $("#install-button");
  const steps = $("#install-steps");
  const openButton = $("#install-open");
  const dismissButton = $("#install-dismiss");
  const moreButton = $("#install-more");
  let dismissed = localStorage.getItem(STORAGE_INSTALL_DISMISSED) === "1";

  function renderSteps() {
    if (isIOSDevice()) {
      steps.innerHTML = "<li>Open this page in Safari.</li><li>Tap the <strong>Share</strong> button <svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-share\"/></svg>.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li>";
    } else {
      steps.innerHTML = "<li>Open the browser menu <svg class=\"icon\" aria-hidden=\"true\"><use href=\"#i-more\"/></svg>.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm to add Drop to your home screen.</li>";
    }
  }

  function showPanel(expandSteps = false) {
    panel.hidden = false;
    if (expandSteps) {
      renderSteps();
      steps.hidden = false;
      moreButton.setAttribute("aria-expanded", "true");
    } else {
      steps.hidden = true;
      moreButton.setAttribute("aria-expanded", "false");
    }
  }

  function hidePanel() {
    panel.hidden = true;
  }

  function onInstalled() {
    hidePanel();
    showToast("Drop installed — look for the icon on your home screen.");
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    button.hidden = false;
    if (!dismissed) showPanel(false);
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    button.hidden = true;
    onInstalled();
  });

  button.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showPanel(true);
      showToast("Open your browser menu to add Drop to your home screen.");
      return;
    }
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    button.disabled = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice && choice.outcome === "accepted") {
        onInstalled();
      } else {
        /* The prompt is single use. Keep the manual route open instead of
           leaving a dead button behind. */
        button.hidden = true;
        showPanel(true);
        showToast("No problem — you can add Drop from your browser menu.");
      }
    } catch (error) {
      button.hidden = true;
      showPanel(true);
      showToast("Couldn't open the install prompt. Use your browser menu instead.");
    } finally {
      button.disabled = false;
    }
  });

  moreButton.addEventListener("click", () => {
    if (steps.hidden) {
      renderSteps();
      steps.hidden = false;
      moreButton.setAttribute("aria-expanded", "true");
    } else {
      steps.hidden = true;
      moreButton.setAttribute("aria-expanded", "false");
    }
  });

  dismissButton.addEventListener("click", () => {
    dismissed = true;
    localStorage.setItem(STORAGE_INSTALL_DISMISSED, "1");
    hidePanel();
  });

  openButton?.addEventListener("click", () => {
    showPanel(true);
    if (deferredInstallPrompt) button.hidden = false;
    panel.scrollIntoView({block:"nearest", behavior: reduceMotion ? "auto" : "smooth"});
  });

  if (isIOSDevice() && !isStandalone() && !dismissed) showPanel(true);
  if (isStandalone()) hidePanel();
}

/* -------------------------------------------------------------------- init */
function setupEntryExperience() {
  const splash = $("#splash-screen");
  const welcome = $("#welcome-screen");
  const app = $(".app-shell");
  const returning = localStorage.getItem(STORAGE_WELCOMED) === "1";
  $("#current-location").textContent = selectedCity;
  welcome.hidden = returning;
  app.hidden = !returning;
  $("#get-started").addEventListener("click", () => {
    localStorage.setItem(STORAGE_WELCOMED, "1");
    welcome.hidden = true;
    app.hidden = false;
    window.scrollTo(0,0);
  });
  window.setTimeout(() => splash.classList.add("is-hidden"), reduceMotion ? 0 : 650);
}
function openLocationDialog() {
  $("#location-dialog").hidden = false;
  $("#location-backdrop").hidden = false;
  $$(".location-option").forEach(option => option.classList.toggle("is-selected", option.dataset.city === selectedCity));
}
function closeLocationDialog() {
  $("#location-dialog").hidden = true;
  $("#location-backdrop").hidden = true;
}

function init() {
  setupEntryExperience();
  $("#location-trigger").addEventListener("click", openLocationDialog);
  $("#location-close").addEventListener("click", closeLocationDialog);
  $("#location-backdrop").addEventListener("click", closeLocationDialog);
  $$(".location-option").forEach(option => option.addEventListener("click", () => {
    selectedCity = option.dataset.city;
    localStorage.setItem(STORAGE_CITY, selectedCity);
    $("#current-location").textContent = selectedCity;
    closeLocationDialog();
    showToast("Location set to " + selectedCity + ".");
  }));
  $("#history-trigger").addEventListener("click", () => switchTab("orders"));
  $("#category-back").addEventListener("click", () => switchTab("new"));
  $(".category-card").forEach(card => card.addEventListener("click", () => openCategory(card.dataset.category)));
  $("#catalog-search-input").addEventListener("input", event => renderCatalogSearch(event.target.value));
  document.addEventListener("click", event => {
    const addButton = event.target.closest("[data-add-product]");
    if (addButton) {
      addCatalogProduct(addButton.dataset.addProduct);
      return;
    }
    const searchResult = event.target.closest("[data-search-category]");
    if (searchResult) {
      $("#catalog-search-results").hidden = true;
      openCategory(searchResult.dataset.searchCategory);
      renderCatalogCategory(searchResult.dataset.searchCategory, searchResult.dataset.searchSubcategory);
      return;
    }
    const increase = event.target.closest("[data-cart-increase]");
    const decrease = event.target.closest("[data-cart-decrease]");
    const remove = event.target.closest("[data-cart-remove]");
    if (increase || decrease || remove) {
      const productId = (increase || decrease || remove).dataset[increase ? "cartIncrease" : decrease ? "cartDecrease" : "cartRemove"];
      const cartItems = getCart();
      const line = cartItems.find(item => item.productId === productId);
      if (line) {
        if (remove || (decrease && line.quantity <= 1)) {
          saveJSON(STORAGE_CART, cartItems.filter(item => item.productId !== productId));
        } else {
          line.quantity = Math.max(1, Math.min(99, line.quantity + (increase ? 1 : -1)));
          saveJSON(STORAGE_CART, cartItems);
        }
        renderCart();
      }
      return;
    }
    const chip = event.target.closest("[data-subcategory-chip]");
    if (chip) {
      $(".subcategory-chip").forEach(item => item.classList.toggle("is-active", item === chip));
    }
    if (!event.target.closest(".catalog-search-wrap")) {
      $("#catalog-search-results").hidden = true;
    }
  });
  $("#cart-trigger").addEventListener("click", () => switchTab("cart"));
  $("#cart-back").addEventListener("click", () => switchTab("new"));
  $("#cart-browse").addEventListener("click", () => switchTab("new"));
  $("#cart-items").addEventListener("click", event => {
    if (event.target.closest("#cart-continue-shopping")) switchTab("new");
    if (event.target.closest("#cart-checkout")) switchTab("checkout");
  });
  $("#checkout-back").addEventListener("click",()=>switchTab("cart"));
  $("#checkout-form").addEventListener("submit",saveCheckout);
  $("#checkout-form").addEventListener("change",event=>{
    if(event.target.name==="timing"){
      const scheduled=event.target.value==="Scheduled";
      $("#checkout-schedule-fields").hidden=!scheduled;
      $("#checkout-date").required=scheduled;
      $("#checkout-time").required=scheduled;
    }
  });
  $("#checkout-gps").addEventListener("click",requestCheckoutGPS);
  $("#checkout-remove-gps").addEventListener("click",()=>{
    const data=getCheckoutData();data.gps=null;saveJSON(STORAGE_CHECKOUT,data);renderCheckoutGPS(null);
    $("#checkout-gps").disabled=false;$("#checkout-gps").innerHTML='<svg class="icon"><use href="#i-pin"/></svg> Add GPS pin';
  });
  $("#checkout-return-cart").addEventListener("click",()=>switchTab("new"));
  $("#whatsapp-open").addEventListener("click",openCatalogWhatsApp);
  $("#whatsapp-copy").addEventListener("click",copyCatalogWhatsAppMessage);

  updateOrderCount();
  renderCart();
  renderOrders();
  setupProductCatalog();
  setupInstallPrompt();


  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Service worker registration failed:", error));
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
