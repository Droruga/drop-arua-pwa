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

const SERVICES = {
  errands: {title:"Town Errands & Delivery", label:"Errands & Delivery", icon:"i-errands", blurb:"Pickups, market runs & quick drops.", price:"UGX 5,000 – 10,000", fields:[
    {name:"pickup",label:"Pickup location",placeholder:"Enter pickup area or landmark",required:true},
    {name:"destination",label:"Drop-off location",placeholder:"Where should we deliver?",required:true},
    {name:"itemNote",label:"What are we picking up?",placeholder:"Parcel, groceries, medicine, documents…",required:true}
  ]},
  restaurant: {title:"Deliveries", label:"Deliveries", icon:"i-utensils", blurb:"Restaurant orders and everyday items, delivered to your door.", price:"Delivery fee confirmed on WhatsApp", fields:[
    {name:"restaurantName",label:"Restaurant",placeholder:"Restaurant name",required:true},
    {name:"orderItems",label:"What would you like to order?",placeholder:"List meals, sizes and quantities",required:true},
    {name:"orderValue",label:"Approximate food total (optional)",placeholder:"e.g. UGX 35,000",required:false}
  ]},
  lawn: {title:"Compound & Lawn Care", label:"Lawn & Compound", icon:"i-lawn", blurb:"Grass, hedges & tidy compounds.", price:"UGX 15,000 – 35,000", fields:[
    {name:"plotSize",label:"Choose your compound size",type:"radio",options:[["Small Plot","Small Plot — UGX 15,000"],["Medium Compound","Medium Compound — UGX 25,000"],["Large / Custom","Large / Custom — Request a quote"]],required:true}
  ]},
  gas: {title:"Cooking Gas & Heavy Refills", label:"Gas Refills", icon:"i-gas", blurb:"We collect, refill & return.", price:"UGX 7,000 delivery fee", fields:[
    {name:"cylinder",label:"Cylinder size",type:"radio",options:[["6kg","6kg"],["12kg / 15kg","12kg / 15kg"]],required:true},
    {name:"station",label:"Preferred refill station",type:"radio",options:[["Total","Total"],["Shell","Shell"],["Stabex","Stabex"],["No preference","No preference"]],required:true}
  ]},
  cleaning: {title:"Home & Office Cleaning", label:"Cleaning", icon:"i-cleaning", blurb:"From quick cleans to deep resets.", price:"UGX 15,000 – 30,000", fields:[
    {name:"cleaningScope",label:"Choose your cleaning scope",type:"radio",options:[["Single Room / Quick Clean","Single Room / Quick Clean — UGX 15,000"],["Full House / Half-Day","Full House / Half-Day — UGX 30,000"]],required:true}
  ]},
  handyman: {title:"Quick Fix / Handyman", label:"Handyman", icon:"i-handyman", blurb:"Plumbing, electrical & small repairs.", price:"UGX 10,000 call-out", fields:[
    {name:"trade",label:"What kind of help?",type:"radio",options:[["Plumbing","Plumbing"],["Electrical","Electrical"],["Locks / Carpentry","Locks / Carpentry"]],required:true},
    {name:"issue",label:"Briefly describe the issue",placeholder:"What needs fixing?",required:true}
  ]}
};

// Restaurant catalogue contract: intentionally empty until the partner shares
// approved menu data. Prices are integer UGX; no sample products are displayed.
const RESTAURANT_CATALOGUE = {
  schemaVersion: 1,
  currency: "UGX",
  partner: { id: "", name: "", location: "", contactPhone: "" },
  items: [], // {id, name, description, imageUrl, category, priceUGX, available, stockQuantity}
  cart: [], // {itemId, quantity, unitPriceUGX}
  order: { deliveryAddress: "", recipientName: "", recipientPhone: "", notes: "" }
};

const STATUS = {
  sent:{label:"Request Sent",step:1,percent:25,icon:"i-clock",tone:""},
  assigned:{label:"Runner Assigned",step:2,percent:50,icon:"i-bell",tone:""},
  progress:{label:"In Progress",step:3,percent:75,icon:"i-bolt",tone:"status-badge--progress"},
  completed:{label:"Completed",step:4,percent:100,icon:"i-check-circle",tone:"status-badge--completed"}
};

const STEP_LABELS = ["Sent", "Assigned", "In progress", "Completed"];
const PHONE_PATTERN = /^[+()\d\s-]{7,20}$/;

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let selectedService = null;
let gpsPin = null;
let deferredInstallPrompt = null;
let toastTimer = null;
let sheetOpen = false;
let sheetCloseTimer = null;
let lastFocused = null;
let selectedCity = localStorage.getItem(STORAGE_CITY) || "Mbarara";

/* ------------------------------------------------------------------ storage */
function readJSON(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch { return fallback; }
}
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function getOrders() { return readJSON(STORAGE_ORDERS, []); }
function saveOrders(orders) { saveJSON(STORAGE_ORDERS, orders); }

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

/* --------------------------------------------------------- order estimation */
function moneyEstimate(service, details) {
  if (service === "lawn") {
    if (details.plotSize === "Small Plot") return "UGX 15,000";
    if (details.plotSize === "Medium Compound") return "UGX 25,000";
    if (details.plotSize === "Large / Custom") return "Quote required";
    return "UGX 15,000 – 35,000";
  }
  if (service === "cleaning") return details.cleaningScope?.startsWith("Single") ? "UGX 15,000" : details.cleaningScope ? "UGX 30,000" : "UGX 15,000 – 30,000";
  if (service === "gas") return "UGX 7,000 delivery";
  if (service === "restaurant") return "Delivery fee confirmed on WhatsApp";
  if (service === "handyman") return "UGX 10,000 call-out";
  return "UGX 5,000 – 10,000";
}

/* ------------------------------------------------------------ service fields */
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}

function buildServiceFields(serviceKey) {
  const config = SERVICES[serviceKey];
  const scope = $("#service-fields");
  scope.innerHTML = config.fields.map(field => {
    if (field.type === "radio") {
      const longOptions = field.options.some(option => option[1].length > 18);
      const layout = longOptions ? "choice-grid choice-grid--stack" : (field.options.length === 3 ? "choice-grid choice-grid--three" : "choice-grid");
      const options = field.options.map(option => `
        <label class="choice">
          <input type="radio" name="${field.name}" value="${escapeHTML(option[0])}"${field.required ? " required" : ""}>
          <span class="choice-face"><span class="choice-text">${escapeHTML(option[1])}</span></span>
        </label>`).join("");
      return `<fieldset class="form-group">
        <legend class="field-label">${field.label}</legend>
        <div class="${layout}">${options}</div>
        <p class="field-error" id="err-${field.name}" role="alert" hidden></p>
      </fieldset>`;
    }
    return `<fieldset class="form-group">
      <legend class="field-label">${field.label}</legend>
      <input class="text-input" id="detail-${field.name}" name="${field.name}" placeholder="${escapeHTML(field.placeholder)}"${field.required ? " required" : ""} maxlength="180" aria-describedby="err-${field.name}">
      <p class="field-error" id="err-${field.name}" role="alert" hidden></p>
    </fieldset>`;
  }).join("");
  updatePriceEstimate();
}

/* Reads the customer's actual choices. Radio groups deliberately return an
   empty string when nothing is selected so that no option is ever assumed. */
function collectServiceDetails() {
  const data = {};
  const scope = $("#service-fields");
  for (const field of SERVICES[selectedService].fields) {
    if (field.type === "radio") {
      const checked = $(`[name="${field.name}"]:checked`, scope);
      data[field.name] = checked ? checked.value : "";
    } else {
      const input = $(`[name="${field.name}"]`, scope);
      data[field.name] = input?.value?.trim() || "";
    }
  }
  return data;
}

function updatePriceEstimate() {
  if (!selectedService) return;
  $("#price-estimate").textContent = moneyEstimate(selectedService, collectServiceDetails());
}

/* --------------------------------------------------------------- validation */
function showFieldError(name, message, input) {
  const box = document.getElementById(`err-${name}`);
  if (box) { box.textContent = message; box.hidden = false; }
  if (input) input.setAttribute("aria-invalid", "true");
}
function clearFieldError(name, input) {
  const box = document.getElementById(`err-${name}`);
  if (box) { box.textContent = ""; box.hidden = true; }
  if (input) input.removeAttribute("aria-invalid");
  $$(`[name="${name}"]`).forEach(el => el.removeAttribute("aria-invalid"));
}
function clearAllErrors() {
  $$(".field-error").forEach(box => { box.textContent = ""; box.hidden = true; });
  $$("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  $("#landmark").removeAttribute("aria-invalid");
  $("#customer-name").removeAttribute("aria-invalid");
  $("#customer-phone").removeAttribute("aria-invalid");
  $("#schedule-time").removeAttribute("aria-invalid");
}

/* Returns true when the form is valid. On failure the first invalid control
   receives focus and every problem is shown inline. */
function validateForm() {
  clearAllErrors();
  let firstInvalid = null;
  let hasError = false;
  const fail = (name, message, input) => {
    hasError = true;
    showFieldError(name, message, input);
    if (!firstInvalid && input) firstInvalid = input;
  };

  for (const field of SERVICES[selectedService].fields) {
    if (!field.required) continue;
    if (field.type === "radio") {
      const radios = $$(`[name="${field.name}"]`, $("#service-fields"));
      if (!radios.some(radio => radio.checked)) {
        /* No option may be assumed on the customer's behalf. The first radio
           carries the error and receives focus so the omission is explicit. */
        fail(field.name, "Choose an option to continue.", radios[0]);
      }
    } else {
      const input = $(`#detail-${field.name}`);
      if (!input.value.trim()) fail(field.name, "This field is required.", input);
    }
  }

  const landmark = $("#landmark");
  if (!landmark.value.trim()) fail("landmark", "Tell us where to go.", landmark);

  const name = $("#customer-name");
  if (!name.value.trim()) fail("customerName", "Enter your name.", name);

  const paymentChoices = $$(`[name="paymentMethod"]`, $("#order-form"));
  if (!paymentChoices.some(option => option.checked)) fail("paymentMethod", "Choose a payment method to continue.", paymentChoices[0]);

  const phone = $("#customer-phone");
  const phoneValue = phone.value.trim();
  if (!phoneValue) {
    fail("customerPhone", "Enter your phone number.", phone);
  } else if (!PHONE_PATTERN.test(phoneValue)) {
    fail("customerPhone", "Enter a valid phone number.", phone);
  }

  if ($('input[name="urgency"]:checked')?.value === "Schedule") {
    const when = $("#schedule-time");
    if (!when.value) fail("scheduleTime", "Choose a date and time.", when);
  }

  const recipientPhone = $("#recipient-phone");
  if (recipientPhone?.value.trim() && !PHONE_PATTERN.test(recipientPhone.value.trim())) fail("recipientPhone", "Enter a valid recipient phone number.", recipientPhone);

  if (hasError) {
    if (firstInvalid && firstInvalid.focus) firstInvalid.focus({preventScroll:false});
    return false;
  }
  return true;
}

/* ---------------------------------------------------------------- the sheet */
function resetGpsUi() {
  const button = $("#gps-button");
  button.hidden = false;
  button.disabled = false;
  button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-pin"/></svg> Attach my GPS pin';
  $("#gps-confirmation").hidden = true;
}

function openSheet(serviceKey, trigger) {
  selectedService = serviceKey;
  gpsPin = null;
  const config = SERVICES[serviceKey];
  lastFocused = trigger || document.activeElement;

  $("#sheet-title").textContent = config.title;
  $("#sheet-sub").textContent = config.blurb;
  $("#sheet-service-icon").innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${config.icon}"/></svg>`;

  buildServiceFields(serviceKey);
  resetGpsUi();
  clearAllErrors();

  const profile = readJSON(STORAGE_PROFILE, {});
  $("#customer-name").value = profile.name || "";
  $("#customer-phone").value = profile.phone || "";
  $("#landmark").value = profile.landmark || "";
  $("#recipient-name").value = "";
  $("#recipient-phone").value = "";
  $("#delivery-notes").value = "";
  $$('[name="paymentMethod"]').forEach(option => { option.checked = false; });
  $('input[name="urgency"][value="Right Now"]').checked = true;
  $("#schedule-fields").hidden = true;
  $("#schedule-time").value = "";

  const sheet = $("#order-sheet");
  const backdrop = $("#sheet-backdrop");
  sheet.hidden = false;
  backdrop.hidden = false;
  sheet.classList.add("is-open");
  backdrop.classList.add("is-open");
  document.body.classList.add("is-locked");
  sheetOpen = true;

  sheet.scrollTop = 0;
  $("#sheet-body-scroll")?.scrollTo?.(0, 0);
  $(".sheet-body").scrollTop = 0;

  requestAnimationFrame(() => sheet.focus({preventScroll:true}));
  syncViewport();
  window.visualViewport?.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("scroll", syncViewport);
}

function closeSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  const sheet = $("#order-sheet");
  const backdrop = $("#sheet-backdrop");
  sheet.classList.remove("is-open");
  backdrop.classList.remove("is-open");
  document.body.classList.remove("is-locked");
  window.visualViewport?.removeEventListener("resize", syncViewport);
  window.visualViewport?.removeEventListener("scroll", syncViewport);

  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    sheet.hidden = true;
    backdrop.hidden = true;
  }, reduceMotion ? 0 : 320);

  if (lastFocused && document.contains(lastFocused)) lastFocused.focus({preventScroll:true});
  lastFocused = null;
}

/* Keeps the sheet above the on-screen keyboard on Android and iOS. */
function syncViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const keyboard = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
  const root = document.documentElement;
  root.style.setProperty("--kb-inset", keyboard + "px");
  root.style.setProperty("--sheet-max-h", Math.max(280, Math.round(viewport.height) - 8) + "px");
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const sheet = $("#order-sheet");
  const nodes = $$(FOCUSABLE, sheet).filter(node => node.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------------- GPS */
function attachGPS() {
  if (!navigator.geolocation) { showToast("GPS is not supported on this device."); return; }
  const button = $("#gps-button");
  button.disabled = true;
  button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-pin"/></svg> Getting your location…';
  navigator.geolocation.getCurrentPosition(position => {
    gpsPin = {lat:position.coords.latitude, lng:position.coords.longitude};
    $("#gps-confirmation").hidden = false;
    button.hidden = true;
    showToast("GPS pin attached to your request.");
  }, error => {
    button.disabled = false;
    button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-pin"/></svg> Attach my GPS pin';
    const message = error.code === 1 ? "Allow location access to attach your GPS pin." : "Couldn't get your location. Add a landmark instead.";
    showToast(message);
  }, {enableHighAccuracy:true, timeout:12000, maximumAge:60000});
}

function removeGPS() {
  gpsPin = null;
  $("#gps-confirmation").hidden = true;
  const button = $("#gps-button");
  button.hidden = false;
  button.disabled = false;
  button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-pin"/></svg> Attach my GPS pin';
}

/* --------------------------------------------------------------- ordering */
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
    "*NEW DROP ORDER · #" + order.id + " 🔴",
    "",
    "*SERVICE:* " + order.serviceTitle,
    "*CITY:* " + (order.city || "Mbarara"),
    "*REQUEST DETAILS:* " + order.detailsSummary,
    "*DELIVERY ADDRESS:* " + order.landmark,
    "*RECIPIENT:* " + (order.recipientName || order.customerName),
    "*RECIPIENT PHONE:* " + (order.recipientPhone || order.customerPhone),
    "*CUSTOMER:* " + order.customerName,
    "*CUSTOMER PHONE:* " + order.customerPhone,
    "*WHEN:* " + order.urgency,
    "*PAYMENT:* " + (order.paymentMethod || "To be agreed with dispatch"),
    "*DELIVERY NOTES:* " + (order.deliveryNotes || "None"),
    "*GPS PIN:* " + (order.gpsUrl || "Not attached"),
    "",
    "*ORDER REF:* " + order.id,
    "_Submitted through Drop · Please confirm availability, delivery fee and payment with customer._"
  ];
  return lines.join("\n");
}
function makeWhatsAppUrl(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
function formatDetails(key, details) {
  const values = Object.values(details).filter(Boolean);
  if (key === "lawn" || key === "cleaning") return `${values.join(" · ")} (${moneyEstimate(key,details)})`;
  if (key === "gas") return `${details.cylinder} cylinder · ${details.station} station · UGX 7,000 delivery`;
  if (key === "restaurant") return `${details.restaurantName} · ${details.orderItems}${details.orderValue ? ` · Food total estimate: ${details.orderValue}` : ""}`;
  if (key === "handyman") return `${details.trade}: ${details.issue} (UGX 10,000 call-out)`;
  return `Pickup: ${details.pickup} · Drop-off: ${details.destination} · Item: ${details.itemNote}`;
}

function submitOrder(event) {
  event.preventDefault();
  if (!selectedService) return;
  if (DISPATCH_PHONE.includes("X") || !/^\d{10,15}$/.test(DISPATCH_PHONE)) {
    showToast("Add your WhatsApp dispatch number in app.js first.");
    return;
  }
  if (!validateForm()) {
    /* Inline errors plus focus on the first problem are the feedback —
       a toast on top of the sheet would cover the fields it refers to. */
    return;
  }

  const details = collectServiceDetails();
  const profile = {name:getFormValue("customerName"), phone:getFormValue("customerPhone"), landmark:getFormValue("landmark")};
  saveJSON(STORAGE_PROFILE, profile);

  const order = {
    id:createOrderId(), serviceKey:selectedService, serviceTitle:SERVICES[selectedService].title,
    details, detailsSummary:formatDetails(selectedService, details),
    urgency:getUrgency(), paymentMethod:$(`[name="paymentMethod"]:checked`)?.value || "", customerName:profile.name, customerPhone:profile.phone,
    recipientName:getFormValue("recipientName"), recipientPhone:getFormValue("recipientPhone"), deliveryNotes:getFormValue("deliveryNotes"),
    landmark:profile.landmark, city:selectedCity, gpsUrl:gpsPin ? `https://www.google.com/maps?q=${gpsPin.lat},${gpsPin.lng}` : "",
    status:"sent", runnerName:"", runnerPhone:"",
    createdAt:new Date().toISOString(), estimate:moneyEstimate(selectedService, details)
  };

  const orders = getOrders();
  orders.unshift(order);
  saveOrders(orders);
  renderOrders();
  updateOrderCount();

  const submitButton = $("#submit-order");
  submitButton.disabled = true;
  submitButton.querySelector(".primary-label").textContent = "Opening WhatsApp…";
  window.location.href = makeWhatsAppUrl(DISPATCH_PHONE, buildWhatsAppMessage(order));
}

/* ----------------------------------------------------------- order tracking */
function syncStatusFromURL() {
  const params = new URLSearchParams(window.location.search);
  const orderId = (params.get("order") || "").replace(/^#/, "").toUpperCase();
  const status = (params.get("status") || "").toLowerCase();
  if (!orderId || !STATUS[status]) return false;
  const orders = getOrders();
  const index = orders.findIndex(order => order.id.toUpperCase() === orderId);
  if (index < 0) return false;
  orders[index].status = status;
  if (params.get("runner")) orders[index].runnerName = params.get("runner").slice(0,70);
  if (params.get("runnerPhone")) orders[index].runnerPhone = params.get("runnerPhone").slice(0,20);
  orders[index].updatedAt = new Date().toISOString();
  saveOrders(orders);
  history.replaceState({}, "", window.location.pathname + window.location.hash);
  return true;
}

function stepperHtml(state, complete) {
  return STEP_LABELS.map((label, index) => {
    const position = index + 1;
    let stateClass = "";
    if (complete || position < state.step) stateClass = "is-done";
    else if (position === state.step) stateClass = "is-current";
    return `<li class="stepper-step ${stateClass}"><span class="stepper-dot" aria-hidden="true"></span><span class="stepper-label">${label}</span></li>`;
  }).join("");
}

function renderOrders() {
  const orders = getOrders();
  const list = $("#orders-list");
  const hasOrders = orders.length > 0;
  $("#empty-state").hidden = hasOrders;
  list.hidden = !hasOrders;
  $("#tracker-summary").hidden = true;
  $("#tracker-summary").innerHTML = "";
  if (!hasOrders) { list.innerHTML = ""; return; }

  list.innerHTML = orders.map(order => {
    const date = new Date(order.createdAt).toLocaleDateString("en-UG",{dateStyle:"medium"});
    return `<article class="order-card order-history-card">
      <div class="order-head">
        <div><p class="order-ref">#${escapeHTML(order.id)}</p><p class="order-date">${date}</p></div>
      </div>
      <h3 class="order-title">${escapeHTML(order.serviceTitle)}</h3>
      <p class="order-detail">${escapeHTML(order.detailsSummary)}</p>
      <p class="order-for">${escapeHTML(order.city || "Mbarara")} · ${escapeHTML(order.landmark || "")}</p>
      <p class="order-for">Payment: ${escapeHTML(order.paymentMethod || "To be agreed")}</p>
      <p class="order-for">Recipient: ${escapeHTML(order.recipientName || order.customerName)} · ${escapeHTML(order.recipientPhone || order.customerPhone)}</p>
    </article>`;
  }).join("");
}

function updateOrderCount() {
  const count = getOrders().length;
  const badge = $("#order-count");
  if (badge) { badge.textContent = count; badge.hidden = count === 0; }
}

/* ------------------------------------------------------------- navigation */
const CATEGORY_LABELS={"groceries":["Groceries","Fresh produce, pantry staples and everyday food."],"convenience":["Convenience","Snacks, drinks, airtime and quick essentials."],"alcohol":["Alcohol & Beverages","Beverages and age-restricted items."],"food":["Food","Meals and restaurant favourites."],"household":["Household","Cleaning, home care and household essentials."],"health":["Health","Health, pharmacy and personal care essentials."],"retail":["Retail","Electronics, stationery and everyday goods."]};
function openCategory(id){
 const details=CATEGORY_LABELS[id]; if(!details)return;
 $("#category-title").textContent=details[0]; $("#category-description").textContent=details[1];
 $("#category-content").innerHTML='<div class="category-loading"><span class="category-loading-mark"><svg class="icon"><use href="#i-basket"/></svg></span><strong>'+escapeHTML(details[0])+'</strong><p>Product listings will be connected in the next catalog phase.</p></div>';
 switchTab("category");
}


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
  $("#new-drop-view").hidden = orders || cart || category;
  $("#category-view").hidden = !category;
  $("#my-drops-view").hidden = !orders;
  $("#cart-view").hidden = !cart;
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
function renderCart() {
  const items = getCart();
  const badge = $("#cart-count");
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
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
    '<button class="secondary-button cart-continue" type="button" id="cart-continue-shopping">Continue shopping</button>';
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
  const updated = syncStatusFromURL();
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
  });

  $$(".service-card").forEach(card => card.addEventListener("click", () => openSheet(card.dataset.service, card)));

  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  $("#order-form").addEventListener("submit", submitOrder);
  $("#gps-button").addEventListener("click", attachGPS);
  $("#remove-gps").addEventListener("click", removeGPS);
  $("#empty-order-button").addEventListener("click", () => switchTab("new"));
  $("#history-back").addEventListener("click", () => switchTab("new"));

  /* Service field listeners are bound once and delegated, so repeated drawer
     opens no longer stack duplicate handlers. */
  $("#service-fields").addEventListener("change", updatePriceEstimate);
  $("#service-fields").addEventListener("input", updatePriceEstimate);
  $("#order-form").addEventListener("change", event => {
    if (event.target.name === "paymentMethod") clearFieldError("paymentMethod");
  });
  $("#service-fields").addEventListener("change", event => {
    const input = event.target;
    if (input.type !== "radio") return;
    clearFieldError(input.name);
  });

  $$('input[name="urgency"]').forEach(input => input.addEventListener("change", () => {
    const schedule = input.value === "Schedule" && input.checked;
    $("#schedule-fields").hidden = !schedule;
    $("#schedule-time").required = schedule;
    if (!schedule) clearFieldError("scheduleTime", $("#schedule-time"));
  }));

  $("#recipient-phone").addEventListener("blur", () => {
    const field = $("#recipient-phone");
    if (field.value.trim() && !PHONE_PATTERN.test(field.value.trim())) showFieldError("recipientPhone", "Enter a valid recipient phone number.", field);
    else clearFieldError("recipientPhone", field);
  });
  $("#customer-phone").addEventListener("blur", () => {
    const phone = $("#customer-phone");
    const value = phone.value.trim();
    if (!value) { phone.setCustomValidity(""); clearFieldError("customerPhone", phone); return; }
    if (!PHONE_PATTERN.test(value)) {
      phone.setCustomValidity("Enter a valid phone number.");
      showFieldError("customerPhone", "Enter a valid phone number.", phone);
    } else {
      phone.setCustomValidity("");
      clearFieldError("customerPhone", phone);
    }
  });
  $("#customer-phone").addEventListener("input", () => {
    const phone = $("#customer-phone");
    if (phone.value.trim() && PHONE_PATTERN.test(phone.value.trim())) {
      phone.setCustomValidity("");
      clearFieldError("customerPhone", phone);
    }
  });

  $("#order-sheet").addEventListener("keydown", trapFocus);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sheetOpen) closeSheet();
  });

  updateOrderCount();
  renderCart();
  renderOrders();
  setupProductCatalog();
  setupInstallPrompt();

  if (updated) { switchTab("orders"); showToast("Your order status has been updated."); }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Service worker registration failed:", error));
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
