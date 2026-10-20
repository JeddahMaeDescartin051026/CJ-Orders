import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const STATUSES = ["COMPLETED", "NOT COMPLETED", "OTHER"];
const TABS = ["ALL"].concat(STATUSES);
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
function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();
  TABS.forEach((t) => {
    const count = t === "ALL" ? orders.length : orders.filter((o) => o.status === t).length;
    const b = el("button", "tab" + (t === filter ? " active" : ""), t);
    b.type = "button";
    b.append(el("span", "", String(count)));
    b.addEventListener("click", () => { filter = t; render(); });
    tabs.appendChild(b);
  });
}

function setStatus(order, status, note) {
  const data = { status: status };
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

function render() {
  renderTabs();
  const pending = orders.filter((o) => o.status === "NOT COMPLETED").length;
  document.title = (pending ? "(" + pending + ") " : "") + "CJ Orders";
  const list = filter === "ALL" ? orders : orders.filter((o) => o.status === filter);
  const box = $("orders");
  box.replaceChildren();
  if (!list.length) { box.appendChild(el("p", "empty", "No orders here yet.")); return; }
  list.forEach((o) => box.appendChild(card(o)));
}
