import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const STATUSES = ["COMPLETED", "NOT COMPLETED", "OTHER"];
const TABS = ["ALL"].concat(STATUSES, ["DUPLICATES", "SUCCESSFUL"]);
const LABELS = { SUCCESSFUL: "SUCCESSFUL ORDERS" };
let orders = [];
let filter = "ALL";
let unsubscribe = null;

const $ = (id) => document.getElementById(id);
const money = (v) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(v || 0);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text; // textContent keeps customer input from running as code
  return n;
}

function phTime(ts) {
  if (!ts || !ts.toDate) return "Just now";
  return ts.toDate().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) + " (PH time)";
}

// ---------- login ----------
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").hidden = true;
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (err) {
    $("login-error").textContent = "Couldn't sign in. Check your email and password.";
    $("login-error").hidden = false;
  }
});
$("signout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  $("login-view").hidden = !!user;
  $("app-view").hidden = !user;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!user) { orders = []; return; }
  unsubscribe = onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc")),
    (snap) => {
      orders = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      render();
    },
    () => {
      $("orders").replaceChildren(el("p", "empty", "Can't load orders. Check your Firestore rules and admin email."));
    }
  );
});

// ---------- render ----------
const manilaDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const createdMs = (o) => (o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().getTime() : Date.now());

// When an order was marked COMPLETED (older orders without the field fall back to the order date)
function soldAt(o) {
  if (o.completedAt === null) return new Date(); // just clicked, server time still pending
  if (o.completedAt && o.completedAt.toDate) return o.completedAt.toDate();
  return o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : null;
}

function soldToday() {
  const today = manilaDay(new Date());
  const rows = [];
  orders.forEach((o) => {
    if (o.status !== "COMPLETED") return;
    const when = soldAt(o);
    if (!when || manilaDay(when) !== today) return;
    (o.items || []).forEach((i) => rows.push({ item: i, order: o, when: when }));
  });
  return rows.sort((a, b) => b.when - a.when);
}

// Products that more than one order asked for
function duplicates() {
  const map = {};
  orders.forEach((o) => {
    const seen = {};
    (o.items || []).forEach((i) => {
      const key = String(i.name || "").trim().toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      (map[key] = map[key] || { name: i.name, orders: [] }).orders.push(o);
    });
  });
  return Object.values(map)
    .filter((g) => g.orders.length > 1)
    .map((g) => { g.orders.sort((a, b) => createdMs(a) - createdMs(b)); return g; }) // first come, first listed
    .sort((a, b) => b.orders.length - a.orders.length);
}

function tabCount(t) {
  if (t === "ALL") return orders.length;
  if (t === "DUPLICATES") return duplicates().length;
  if (t === "SUCCESSFUL") return soldToday().reduce((n, r) => n + (r.item.quantity || 0), 0);
  return orders.filter((o) => o.status === t).length;
}

function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();
  TABS.forEach((t) => {
    const b = el("button", "tab" + (t === filter ? " active" : ""), LABELS[t] || t);
    b.type = "button";
    b.append(el("span", "", String(tabCount(t))));
    b.addEventListener("click", () => { filter = t; render(); });
    tabs.appendChild(b);
  });
}

function setStatus(order, status, note) {
  const data = { status: status };
  if (status === "COMPLETED") { if (order.status !== "COMPLETED") data.completedAt = serverTimestamp(); }
  else data.completedAt = deleteField();
  if (status === "OTHER") data.note = note;
  updateDoc(doc(db, "orders", order.id), data).catch(() => alert("Couldn't update this order. Please try again."));
}

function card(o) {
  const status = STATUSES.indexOf(o.status) >= 0 ? o.status : "NOT COMPLETED";
  const c = el("article", "panel order");

  const top = el("div", "order-top");
  top.append(el("div", "order-date", phTime(o.createdAt)), el("span", "badge " + status.replace(" ", "-"), status));

  const dl = el("dl", "details");
  [["Name", o.name], ["Phone", o.phone], ["Social media", o.social], ["Address", o.address]].forEach((r) => {
    dl.append(el("dt", "", r[0]), el("dd", "", r[1] || "-"));
  });

  const items = el("div", "items");
  (o.items || []).forEach((i) => {
    const row = el("div", "item");
    row.append(el("span", "", i.quantity + " × " + i.name), el("span", "", money(i.price * i.quantity)));
    items.appendChild(row);
  });
  const total = el("div", "total");
  total.append(el("span", "", "Total"), el("span", "", money(o.total)));
  items.appendChild(total);

  const note = el("input", "note");
  note.type = "text";
  note.placeholder = "Note for OTHER (e.g. waiting for payment)";
  note.maxLength = 200;
  note.value = o.note || "";

  const actions = el("div", "actions");
  STATUSES.forEach((s) => {
    const b = el("button", "btn" + (s === status ? " on" : ""), s);
    b.type = "button";
    b.dataset.s = s;
    b.addEventListener("click", () => setStatus(o, s, note.value.trim()));
    actions.appendChild(b);
  });

  c.append(top, dl, items, note, actions);
  return c;
}

function dupCard(g) {
  const c = el("article", "panel order");
  const top = el("div", "order-top");
  top.append(el("div", "dup-name", g.name), el("span", "badge dup", g.orders.length + " PEOPLE WANT THIS"));
  c.appendChild(top);
  if (g.orders.some((o) => o.status === "COMPLETED")) {
    c.appendChild(el("p", "sold-note", "Already marked COMPLETED for one buyer."));
  }
  g.orders.forEach((o, idx) => {
    const status = STATUSES.indexOf(o.status) >= 0 ? o.status : "NOT COMPLETED";
    const row = el("div", "buyer");
    const info = el("div", "buyer-info");
    info.append(
      el("strong", "", (idx + 1) + ". " + (o.name || "-")),
      el("span", "muted", phTime(o.createdAt)),
      el("span", "", "Phone: " + (o.phone || "-")),
      el("span", "", "Social: " + (o.social || "-"))
    );
    row.append(info, el("span", "badge " + status.replace(" ", "-"), status));
    c.appendChild(row);
  });
  return c;
}

function soldCard(r) {
  const c = el("article", "panel sold");
  const left = el("div", "buyer-info");
  left.append(
    el("strong", "", (r.item.quantity || 1) + " × " + r.item.name),
    el("span", "muted", (r.order.name || "-") + " · " + (r.order.social || "-"))
  );
  const right = el("div", "sold-right");
  right.append(
    el("strong", "", money((r.item.price || 0) * (r.item.quantity || 0))),
    el("span", "muted", r.when.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", timeStyle: "short" }))
  );
  c.append(left, right);
  return c;
}

function render() {
  renderTabs();
  const pending = orders.filter((o) => o.status === "NOT COMPLETED").length;
  document.title = (pending ? "(" + pending + ") " : "") + "CJ Orders";
  const box = $("orders");
  box.replaceChildren();

  if (filter === "DUPLICATES") {
    const groups = duplicates();
    if (!groups.length) box.appendChild(el("p", "empty", "No items have been ordered by more than one person."));
    groups.forEach((g) => box.appendChild(dupCard(g)));
    return;
  }

  if (filter === "SUCCESSFUL") {
    const rows = soldToday();
    const qty = rows.reduce((n, r) => n + (r.item.quantity || 0), 0);
    const sum = rows.reduce((n, r) => n + (r.item.price || 0) * (r.item.quantity || 0), 0);
    const head = el("div", "panel summary");
    head.append(el("strong", "", "Sold today: " + qty + (qty === 1 ? " item" : " items")), el("strong", "", money(sum)));
    box.appendChild(head);
    if (!rows.length) box.appendChild(el("p", "empty", "Nothing marked COMPLETED today yet."));
    rows.forEach((r) => box.appendChild(soldCard(r)));
    return;
  }

  const list = filter === "ALL" ? orders : orders.filter((o) => o.status === filter);
  if (!list.length) { box.appendChild(el("p", "empty", "No orders here yet.")); return; }
  list.forEach((o) => box.appendChild(card(o)));
}

// "Today" follows Philippine time, so refresh the Successful Orders list when the day changes
let lastDay = manilaDay(new Date());
setInterval(() => {
  const d = manilaDay(new Date());
  if (d !== lastDay) { lastDay = d; render(); }
}, 60000);
