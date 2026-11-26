/* Drop — lightweight, client-side PWA.
   Set DISPATCH_PHONE to your WhatsApp number in international format, digits only.
   Uganda example: 256772000000 (no +, spaces or leading 0).

   Business logic (services, pricing, order records, WhatsApp payload, order IDs
   and local storage) is kept separate from presentation helpers. */
const DISPATCH_PHONE = "256702964822";
// Replace this placeholder with the confirmed Drop MTN MoMo merchant details.
const PAYMENT_MOMO = "MTN MoMo 0772 000 000 — Drop";
const STORAGE_ORDERS = "drop_orders";
const STORAGE_PROFILE = "drop_customer";
const STORAGE_INSTALL_DISMISSED = "drop_install_dismissed";
const STORAGE_WELCOMED = "drop_welcomed";
const STORAGE_CITY = "drop_city";

const SERVICES = {
  errands: {title:"Town Errands & Delivery", label:"Errands & Delivery", icon:"i-errands", blurb:"Pickups, market runs & quick drops.", price:"UGX 5,000 – 10,000", turnaround:"Same day", fields:[
    {name:"pickup",label:"Pickup location",placeholder:"Enter pickup area or landmark",required:true},
    {name:"destination",label:"Drop-off location",placeholder:"Where should we deliver?",required:true},
    {name:"itemNote",label:"What are we picking up?",placeholder:"Parcel, groceries, medicine, documents…",required:true}
  ]},
  restaurant: {title:"Restaurant Delivery", label:"Restaurant Delivery", icon:"i-utensils", blurb:"Order from our restaurant partner and have it brought to you.", price:"Delivery fee confirmed on WhatsApp", turnaround:"45–60 min", fields:[
    {name:"restaurantName",label:"Restaurant",placeholder:"Restaurant name",required:true},
    {name:"orderItems",label:"What would you like to order?",placeholder:"List meals, sizes and quantities",required:true},
    {name:"orderValue",label:"Approximate food total (optional)",placeholder:"e.g. UGX 35,000",required:false}
  ]},
  lawn: {title:"Compound & Lawn Care", label:"Lawn & Compound", icon:"i-lawn", blurb:"Grass, hedges & tidy compounds.", price:"UGX 15,000 – 35,000", turnaround:"Book 24h ahead", fields:[
    {name:"plotSize",label:"Choose your compound size",type:"radio",options:[["Small Plot","Small Plot — UGX 15,000"],["Medium Compound","Medium Compound — UGX 25,000"],["Large / Custom","Large / Custom — Request a quote"]],required:true}
  ]},
  gas: {title:"Cooking Gas & Heavy Refills", label:"Gas Refills", icon:"i-gas", blurb:"We collect, refill & return.", price:"UGX 7,000 delivery fee", turnaround:"2–3 hours", fields:[
    {name:"cylinder",label:"Cylinder size",type:"radio",options:[["6kg","6kg"],["12kg / 15kg","12kg / 15kg"]],required:true},
    {name:"station",label:"Preferred refill station",type:"radio",options:[["Total","Total"],["Shell","Shell"],["Stabex","Stabex"],["No preference","No preference"]],required:true}
  ]},
  cleaning: {title:"Home & Office Cleaning", label:"Cleaning", icon:"i-cleaning", blurb:"From quick cleans to deep resets.", price:"UGX 15,000 – 30,000", turnaround:"Book 24h ahead", fields:[
    {name:"cleaningScope",label:"Choose your cleaning scope",type:"radio",options:[["Single Room / Quick Clean","Single Room / Quick Clean — UGX 15,000"],["Full House / Half-Day","Full House / Half-Day — UGX 30,000"]],required:true}
  ]},
  handyman: {title:"Quick Fix / Handyman", label:"Handyman", icon:"i-handyman", blurb:"Plumbing, electrical & small repairs.", price:"UGX 10,000 call-out", turnaround:"Same-day call-out", fields:[
    {name:"trade",label:"What kind of help?",type:"radio",options:[["Plumbing","Plumbing"],["Electrical","Electrical"],["Locks / Carpentry","Locks / Carpentry"]],required:true},
    {name:"issue",label:"Briefly describe the issue",placeholder:"What needs fixing?",required:true}
  ]}
};

const STATUS = {
  sent:{label:"Requested",step:1,percent:25,icon:"i-clock",tone:""},
  assigned:{label:"Confirmed",step:2,percent:50,icon:"i-bell",tone:""},
  progress:{label:"On the way",step:3,percent:75,icon:"i-bolt",tone:"status-badge--progress"},
  completed:{label:"Delivered",step:4,percent:100,icon:"i-check-circle",tone:"status-badge--completed"}
};

const STEP_LABELS = ["Requested", "Confirmed", "On the way", "Delivered"];
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

function renderServiceCards() {
  const grid = $("#service-grid");
  grid.innerHTML = Object.entries(SERVICES).map(([key, service]) => `
    <li>
      <button class="service-card" type="button" data-service="${key}" aria-label="${escapeHTML(service.label)}. ${escapeHTML(service.blurb)} Price: ${escapeHTML(service.price)}. Typical turnaround: ${escapeHTML(service.turnaround)}.">
        <span class="service-icon service-icon--${key}" aria-hidden="true"><svg class="icon"><use href="#${service.icon}"/></svg></span>
        <span class="service-body">
          <span class="service-name">${escapeHTML(service.label)}</span>
          <span class="service-desc">${escapeHTML(service.blurb)}</span>
          <span class="service-price">${escapeHTML(service.price)}</span>
          <span class="service-turnaround"><span class="service-turnaround-dot" aria-hidden="true"></span>${escapeHTML(service.turnaround)}</span>
        </span>
        <svg class="service-chevron icon" aria-hidden="true"><use href="#i-chevron-right"/></svg>
      </button>
    </li>`).join("");
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
  const recipientName = order.recipientName || order.customerName;
  const recipientPhone = order.recipientPhone || order.customerPhone;
  const city = order.city || "Mbarara";
  const payment = order.paymentMethod || "To confirm";
  const lines = [
    "*NEW DROP · #" + order.id,
    "",
    "*Service:* " + order.serviceTitle,
    "*City:* " + city,
    "*When:* " + (order.urgency || "To confirm"),
    "",
    "*Details:* " + (order.detailsSummary || "To confirm"),
    "*Delivery:* " + (order.landmark || "To confirm"),
    "*Recipient:* " + recipientName + " · " + recipientPhone,
    "*Customer:* " + order.customerName + " · " + order.customerPhone,
    "",
    "*Estimate:* " + (order.estimate || "To confirm"),
    "*Payment:* " + payment
  ];
  if (payment === "MTN MoMo") lines.push("*Pay to:* " + PAYMENT_MOMO + " (ref " + order.id + ")");
  if (order.gpsUrl) lines.push("*GPS:* " + order.gpsUrl);
  if (order.deliveryNotes) lines.push("*Notes:* " + order.deliveryNotes);
  lines.push(
    "",
    "*Reply CONFIRM to accept.*",
    "We'll send the final total and payment instructions here.",
    "",
    "_Ref: " + order.id + " · Drop " + city + "_"
  );
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
  if (localStorage.getItem(STORAGE_INSTALL_DISMISSED) !== "1" && !isStandalone()) $("#install-panel").hidden = false;

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
    const state = STATUS[order.status] || STATUS.sent;
    const date = new Date(order.createdAt).toLocaleDateString("en-UG",{dateStyle:"medium"});
    return `<article class="order-card order-history-card">
      <div class="order-head">
        <div><p class="order-ref">#${escapeHTML(order.id)}</p><p class="order-date">${date}</p></div>
        <span class="status-badge ${state.tone}">${state.label}</span>
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
function switchTab(tab) {
  const orders = tab === "orders";
  $("#new-drop-view").hidden = orders;
  $("#my-drops-view").hidden = !orders;
  if (orders) renderOrders();
  window.scrollTo({top:0, behavior:reduceMotion ? "auto" : "smooth"});
}

function scrollToServices() {
  $("#services")?.scrollIntoView({behavior:reduceMotion ? "auto" : "smooth", block:"start"});
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

  function showPanel(expandSteps = false, manual = false) {
    if (dismissed && !manual) return;
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
    showPanel(true, true);
    if (deferredInstallPrompt) button.hidden = false;
    panel.scrollIntoView({block:"nearest", behavior: reduceMotion ? "auto" : "smooth"});
  });

  if (isStandalone()) hidePanel();
  else if (getOrders().length > 0 && !dismissed) showPanel(false);
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
  renderServiceCards();
  $$(".service-card").forEach(card => card.addEventListener("click", () => openSheet(card.dataset.service, card)));
  $("#hero-start-button").addEventListener("click", scrollToServices);

  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  $("#order-form").addEventListener("submit", submitOrder);
  $("#gps-button").addEventListener("click", attachGPS);
  $("#remove-gps").addEventListener("click", removeGPS);
  $("#empty-order-button").addEventListener("click", () => {
    switchTab("new");
    requestAnimationFrame(scrollToServices);
  });
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
  renderOrders();
  setupInstallPrompt();

  if (updated) { switchTab("orders"); showToast("Your order status has been updated."); }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Service worker registration failed:", error));
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
