const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const cinematic = $("#cinematic");
let cinematicTimer;
let cinematicDismissed = false;

function dismissCinematic() {
  if (cinematicDismissed) return;
  cinematicDismissed = true;
  clearTimeout(cinematicTimer);
  cinematic.classList.add("is-leaving");
  document.body.classList.remove("intro-active");
  $$(".nav, main, footer").forEach((section) => section.removeAttribute("inert"));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cinematic.remove();
    $(".logo").focus({ preventScroll: true });
    return;
  }
  setTimeout(() => {
    cinematic.remove();
    $(".logo").focus({ preventScroll: true });
  }, 600);
}

if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  dismissCinematic();
} else {
  cinematic.focus({ preventScroll: true });
  cinematicTimer = setTimeout(dismissCinematic, 2450);
}

/* =====================================================
   1. COMMITTEES  (edit names, agendas and descriptions here)
   code MUST match the "committee" column in users.csv
   ===================================================== */
const COMMITTEES = [
  { code: "DISEC", name: "Disarmament & International Security Committee", type: "General Assembly", level: "Beginner", desc: "Arms control, nuclear non-proliferation and global security threats.", agenda: "Regulating autonomous weapons systems" },
  { code: "SOCHUM", name: "Social, Humanitarian & Cultural Committee", type: "General Assembly", level: "Beginner", desc: "Human rights, cultural heritage and humanitarian questions worldwide.", agenda: "Protecting refugee children's right to education" },
  { code: "ECOFIN", name: "Economic & Financial Committee", type: "General Assembly", level: "Beginner", desc: "Global trade, debt, development finance and sustainable growth.", agenda: "Debt relief for developing economies" },
  { code: "SPECPOL", name: "Special Political & Decolonization Committee", type: "General Assembly", level: "Intermediate", desc: "Decolonisation, peacekeeping, space and outer-space affairs.", agenda: "Peacekeeping reform in fragile states" },
  { code: "LEGAL", name: "Legal Committee", type: "General Assembly", level: "Intermediate", desc: "International law, state responsibility and treaty development.", agenda: "Legal status of cyber operations" },
  { code: "UNSC", name: "United Nations Security Council", type: "Security Council", level: "Advanced", desc: "The body responsible for international peace and security. Resolutions here are binding.", agenda: "Ceasefire frameworks in ongoing conflicts" },
  { code: "UNHRC", name: "United Nations Human Rights Council", type: "Specialised", level: "Intermediate", desc: "Promoting and protecting human rights across the globe.", agenda: "Digital privacy and state surveillance" },
  { code: "WHO", name: "World Health Organization", type: "Specialised", level: "Intermediate", desc: "Global public health, pandemic preparedness and health equity.", agenda: "Pandemic preparedness and vaccine equity" },
  { code: "UNEP", name: "United Nations Environment Programme", type: "Specialised", level: "Beginner", desc: "Climate action, biodiversity and environmental governance.", agenda: "Plastic pollution in the world's oceans" },
  { code: "UNESCO", name: "United Nations Educational, Scientific & Cultural Organization", type: "Specialised", level: "Beginner", desc: "Education, science, culture and the protection of heritage.", agenda: "Safeguarding heritage sites in conflict zones" },
  { code: "UNICEF", name: "United Nations Children's Fund", type: "Specialised", level: "Beginner", desc: "Child welfare, nutrition, protection and education.", agenda: "Eliminating child labour in supply chains" },
  { code: "UNDP", name: "United Nations Development Programme", type: "Specialised", level: "Beginner", desc: "Poverty eradication, governance and the Sustainable Development Goals.", agenda: "Accelerating progress on the SDGs" },
  { code: "ECOSOC", name: "Economic and Social Council", type: "Principal Organ", level: "Intermediate", desc: "Coordinates the UN's economic, social and environmental work.", agenda: "Reducing inequality in the digital economy" },
  { code: "IAEA", name: "International Atomic Energy Agency", type: "Specialised", level: "Advanced", desc: "Nuclear safety, safeguards and peaceful uses of atomic energy.", agenda: "Safeguarding civilian nuclear facilities" },
  { code: "NATO", name: "North Atlantic Treaty Organization", type: "Regional", level: "Advanced", desc: "Collective defence and security cooperation among allied states.", agenda: "Strengthening eastern-flank deterrence" },
  { code: "INTERPOL", name: "International Criminal Police Organization", type: "Specialised", level: "Intermediate", desc: "Cross-border policing, organised crime and cybercrime.", agenda: "Combating transnational human trafficking" },
  { code: "UN WOMEN", name: "UN Entity for Gender Equality & the Empowerment of Women", type: "Specialised", level: "Beginner", desc: "Gender equality, women's leadership and protection from violence.", agenda: "Closing the gender gap in political leadership" },
  { code: "WTO", name: "World Trade Organization", type: "Specialised", level: "Intermediate", desc: "Global trade rules, disputes and tariffs.", agenda: "Reforming the dispute settlement system" },
  { code: "ICJ", name: "International Court of Justice", type: "Principal Organ", level: "Advanced", desc: "Settles legal disputes between states and gives advisory opinions.", agenda: "A sample contentious case (to be announced)" },
  { code: "UNHCR", name: "UN High Commissioner for Refugees", type: "Specialised", level: "Intermediate", desc: "Protecting refugees, displaced and stateless people.", agenda: "Durable solutions for protracted displacement" },
  { code: "HSC", name: "Historical Security Council", type: "Crisis / Historical", level: "Advanced", desc: "Debate a landmark historical crisis as it unfolded, in real time.", agenda: "A historical crisis (to be announced)" },
  { code: "UNCTAD", name: "UN Conference on Trade and Development", type: "Specialised", level: "Intermediate", desc: "Helping developing countries benefit from global trade and investment.", agenda: "Trade and the green transition" },
];

/* =====================================================
   2. SCHEDULE  (edit times and events here)
   ===================================================== */
const SCHEDULE = [
  { tab: "Day 1 · Fri 23 Apr 2027", items: [
    ["08:00", "Registration & Check-in", "Collect badges and committee folders"],
    ["09:30", "Opening Ceremony", "Welcome address and keynote"],
    ["11:00", "Committee Session I", "Roll call, agenda setting, opening speeches"],
    ["13:00", "Lunch Break", ""],
    ["14:00", "Committee Session II", "Moderated and unmoderated caucuses"],
    ["16:30", "Lobbying & E-Chits", "Find allies and start drafting"],
    ["17:30", "Day 1 Closes", ""],
  ]},
  { tab: "Day 2 · Sat 24 Apr 2027", items: [
    ["08:30", "Doors Open", ""],
    ["09:00", "Committee Session III", "Working papers and directives"],
    ["11:30", "Committee Session IV", "Draft resolutions take shape"],
    ["13:00", "Lunch Break", ""],
    ["14:00", "Committee Session V", "Amendments and crisis updates"],
    ["17:00", "Delegate Social", "Networking and games"],
  ]},
  { tab: "Day 3 · Sun 25 Apr 2027", items: [
    ["08:30", "Doors Open", ""],
    ["09:00", "Final Committee Session", "Voting on resolutions"],
    ["12:30", "Lunch Break", ""],
    ["13:30", "Closing Ceremony", "Awards and group photo"],
    ["15:30", "Conference Ends", "See you at DXBMUN 28!"],
  ]},
];

/* ---------- schedule rendering ---------- */
(function schedule() {
  const tabs = $("#day-tabs"), list = $("#timeline");
  function show(i) {
    $$("button", tabs).forEach((b, n) => {
      b.classList.toggle("on", n === i);
      b.setAttribute("aria-selected", String(n === i));
      b.tabIndex = n === i ? 0 : -1;
    });
    list.setAttribute("aria-labelledby", `schedule-tab-${i}`);
    list.innerHTML = SCHEDULE[i].items.map(([t, title, note]) =>
      `<li><span class="t-time">${t}</span><div><div class="t-title">${esc(title)}</div><div class="t-note">${esc(note)}</div></div></li>`).join("");
  }
  tabs.innerHTML = SCHEDULE.map((d, i) =>
    `<button type="button" role="tab" id="schedule-tab-${i}" aria-controls="timeline" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${esc(d.tab)}</button>`).join("");
  $$("button", tabs).forEach((b, i) => b.addEventListener("click", () => show(i)));
  tabs.addEventListener("keydown", (e) => {
    const buttons = $$("button", tabs);
    const current = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (current + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      show(next);
    }
  });
  show(0);
})();

/* =====================================================
   3. COMMITTEE PINWHEEL  (arcade-style, scroll to spin)
   ===================================================== */
(function pinwheel() {
  const N = COMMITTEES.length;
  const wheel = $("#wheel"), info = $("#pin-info"), ticket = $("#ticket");
  let idx = 0, spinning = false;

  wheel.innerHTML = COMMITTEES.map((c, i) => `<div class="w-item" data-i="${i}">${esc(c.code)}</div>`).join("");
  const items = $$(".w-item", wheel);

  function offset(i) {
    let d = (i - idx) % N;
    if (d > N / 2) d -= N;
    if (d < -N / 2) d += N;
    return d;
  }

  function render() {
    items.forEach((el, i) => {
      const d = offset(i), a = Math.abs(d);
      el.style.transform = `translate(-50%, -50%) translateY(${d * 62}px) scale(${Math.max(0.5, 1 - a * 0.12)})`;
      el.style.opacity = a > 3 ? 0 : 1 - a * 0.28;
      el.style.pointerEvents = a > 3 ? "none" : "auto";
      el.classList.toggle("active", d === 0);
    });
    const c = COMMITTEES[idx];
    info.innerHTML = `
      <div class="pin-count">${String(idx + 1).padStart(2, "0")} / ${N}</div>
      <div class="pin-code">${esc(c.code)}</div>
      <div class="pin-name">${esc(c.name)}</div>
      <div class="chips"><span>${esc(c.type)}</span><span>${esc(c.level)}</span></div>
      <p class="pin-desc">${esc(c.desc)}</p>
      <p class="pin-desc pin-agenda"><b>Agenda:</b> ${esc(c.agenda)}</p>
      <div class="pin-ctrl">
        <button type="button" class="circle-btn" id="prev" aria-label="Previous committee">←</button>
        <button type="button" class="circle-btn" id="next" aria-label="Next committee">→</button>
        <button type="button" class="btn ghost" id="surprise">Surprise me</button>
      </div>`;
    $("#prev").onclick = () => step(-1);
    $("#next").onclick = () => step(1);
    $("#surprise").onclick = spin;
  }

  function step(n) { if (spinning) return; idx = (idx + n + N) % N; render(); }

  // tap an item
  wheel.addEventListener("click", (e) => {
    const el = e.target.closest(".w-item");
    if (el && !dragged) step(offset(Number(el.dataset.i)));
  });

  // scroll = pull the lever
  let acc = 0, lastWheel = 0;
  wheel.addEventListener("wheel", (e) => {
    e.preventDefault();
    acc += e.deltaY;
    const now = Date.now();
    if (Math.abs(acc) > 40 && now - lastWheel > 90) {
      step(acc > 0 ? 1 : -1);
      acc = 0; lastWheel = now;
    }
  }, { passive: false });

  // drag
  let startY = null, dragged = false;
  wheel.addEventListener("pointerdown", (e) => { startY = e.clientY; dragged = false; wheel.setPointerCapture(e.pointerId); wheel.style.cursor = "grabbing"; });
  wheel.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 50) { step(dy < 0 ? 1 : -1); startY = e.clientY; dragged = true; }
  });
  const end = () => { startY = null; wheel.style.cursor = "grab"; setTimeout(() => (dragged = false), 50); };
  wheel.addEventListener("pointerup", end);
  wheel.addEventListener("pointercancel", end);

  // keyboard (click the wheel first)
  wheel.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowRight"].includes(e.key)) { e.preventDefault(); step(1); }
    if (["ArrowUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); step(-1); }
  });

  // arcade spin
  function spin() {
    if (spinning) return;
    spinning = true; ticket.textContent = "";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      idx = Math.floor(Math.random() * N);
      render();
      spinning = false;
      ticket.textContent = `Selected: ${COMMITTEES[idx].code}`;
      return;
    }
    const total = 28 + Math.floor(Math.random() * N);
    let i = 0;
    (function tick() {
      idx = (idx + 1) % N; render(); i++;
      if (i < total) setTimeout(tick, 35 + Math.pow(i / total, 3) * 280);
      else {
        spinning = false; render();
        ticket.textContent = `Selected: ${COMMITTEES[idx].code}`;
        info.classList.add("pop");
        setTimeout(() => { info.classList.remove("pop"); ticket.textContent = ""; }, 2500);
      }
    })();
  }

  render();
})();

/* =====================================================
   4. E-CHITS
   ===================================================== */
let me = null, pollTimer = null;
const ROLE_NAME = { delegate: "Delegate", chair: "Chair", admin: "Admin" };

async function api(path, body) {
  const opt = body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(data.error || "Something went wrong");
    error.status = r.status;
    throw error;
  }
  return data;
}

function showStatus(message, isError = false) {
  const status = $("#ec-status");
  status.textContent = message;
  status.classList.toggle("err", isError && Boolean(message));
  status.classList.toggle("ok", !isError && Boolean(message));
}

const roleLabel = (u) => {
  if (u.role === "delegate") return ["Delegate", u.country, u.committee].filter(Boolean).join(" · ");
  if (u.role === "chair") return ["Chair", u.committee].filter(Boolean).join(" · ");
  return "Admin";
};

function showTab(name) {
  $$("#ec-tabs button").forEach((b) => {
    const selected = b.dataset.tab === name;
    b.classList.toggle("on", selected);
    b.setAttribute("aria-selected", String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  $$(".ec-panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
}
$("#ec-tabs").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-tab]");
  if (button && !button.hidden) showTab(button.dataset.tab);
});
$("#ec-tabs").addEventListener("keydown", (e) => {
  const buttons = $$("#ec-tabs button:not([hidden])");
  const current = buttons.indexOf(document.activeElement);
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const next = (current + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    showTab(buttons[next].dataset.tab);
  }
});

function personLabel(name, country, role) {
  return `${esc(name || "—")}${country ? ` (${esc(country)})` : role === "chair" ? " (Chair)" : role === "admin" ? " (Admin)" : ""}`;
}

function msgCard(m, mode) {
  const when = new Date(m.created * 1000).toLocaleString();
  const route = mode === "sent"
    ? `To: ${personLabel(m.rname, m.rcountry, m.rrole)}`
    : `From: ${personLabel(m.sname, m.scountry, m.srole)}` + (mode === "queue" ? ` → ${personLabel(m.rname, m.rcountry, m.rrole)}` : "");
  const actions = mode === "queue"
    ? `<div class="actions">
         <input placeholder="Optional note to sender">
         <button class="btn gold" data-act="approve">Approve</button>
         <button class="btn red" data-act="reject">Reject</button>
       </div>` : "";
  const replyAction = mode === "in" && m.kind === "chit"
    ? `<button type="button" class="btn gold reply-btn" data-reply="${m.id}">Reply</button>` : "";
  return `<div class="msg" data-id="${m.id}">
    <div class="msg-top"><span class="tag">${esc(m.kind)}</span><span class="tag ${esc(m.status)}">${esc(m.status)}</span></div>
    <h4>${esc(m.subject)}</h4>
    <div class="meta">${route} · ${esc(when)}</div>
    <div class="body">${esc(m.body)}</div>
    ${m.note ? `<div class="note">Chair note: ${esc(m.note)}</div>` : ""}
    ${actions}
    ${replyAction}
  </div>`;
}
const empty = (t) => `<p class="empty">${t}</p>`;

async function refresh() {
  if (!me) return;
  try {
    const box = await api("/api/inbox");
    $('[data-panel="inbox"]').innerHTML = box.received.map((m) => msgCard(m, "in")).join("") || empty("No messages yet.");
    $('[data-panel="sent"]').innerHTML = box.sent.map((m) => msgCard(m, "sent")).join("") || empty("You haven't sent anything yet.");
    $("#cnt-inbox").textContent = box.received.length;
    if (me.role !== "delegate") {
      const q = await api("/api/queue");
      $("#cnt-queue").textContent = q.length;
      const panel = $('[data-panel="queue"]');
      if (!document.activeElement.matches("#panel-queue input")) {   // don't wipe a note you're typing
        panel.innerHTML = q.map((m) => msgCard(m, "queue")).join("") || empty("Nothing waiting for approval.");
      }
    }
    showStatus("");
  } catch (e) {
    if (e.status === 401) {
      leave();
      $("#login-err").textContent = "Your session has expired. Please log in again.";
    } else {
      showStatus(e.message || "Unable to refresh E-Chits. Please try again.", true);
    }
  }
}

$('[data-panel="queue"]').addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const card = b.closest(".msg");
  $$("button", card).forEach((button) => { button.disabled = true; });
  try {
    await api("/api/review", { id: Number(card.dataset.id), action: b.dataset.act, note: $("input", card).value });
    document.activeElement.blur();
    await refresh();
  } catch (x) { showStatus(x.message || "Unable to update this message.", true); }
  finally { $$("button", card).forEach((button) => { button.disabled = false; }); }
});

$('[data-panel="inbox"]').addEventListener("click", (e) => {
  const button = e.target.closest("[data-reply]");
  if (!button) return;
  const card = button.closest(".msg");
  const subject = $("h4", card).textContent.trim();
  $("#reply-to-id").value = button.dataset.reply;
  $("#kind").value = "chit";
  $("#kind").disabled = true;
  $("#to-wrap").hidden = true;
  $("#kind-hint").textContent = "Your reply will be sent to the original sender.";
  $("#subject").value = (/^re:/i.test(subject) ? subject : `Re: ${subject}`).slice(0, 120);
  $("#body").value = "";
  $("#send-msg").textContent = "";
  $("#send-msg").className = "ok";
  showTab("compose");
  $("#body").focus();
});

async function loadDirectory() {
  const people = await api("/api/directory");
  $("#to").innerHTML = people.length
    ? people.map((p) => {
      const details = [p.country || ROLE_NAME[p.role], p.committee].filter(Boolean).join(" · ");
      return `<option value="${p.id}">${esc(p.name)} — ${esc(details)}</option>`;
    }).join("")
    : `<option value="" disabled selected>No recipients available</option>`;
}

function updateKindHint() {
  const k = $("#kind").value;
  const replying = Boolean($("#reply-to-id").value);
  $("#to-wrap").hidden = k !== "chit" || replying;
  $("#kind-hint").textContent = replying ? "Your reply will be sent to the original sender."
    : k === "chit" ? (me.role === "delegate" ? "Chits to other delegates are checked by your chair before delivery. Chits to the chair or admin are delivered instantly." : "Delivered instantly.")
    : "Goes to your chair for approval.";
}
$("#kind").addEventListener("change", updateKindHint);

function clearReply() {
  $("#reply-to-id").value = "";
  $("#kind").disabled = false;
  if (me) updateKindHint();
}

$("#compose-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#send-msg"); msg.textContent = ""; msg.className = "ok";
  const submit = $("button[type='submit']", e.currentTarget);
  submit.disabled = true;
  try {
    const kind = $("#kind").value;
    const replyTo = $("#reply-to-id").value;
    const r = await api("/api/send", {
      kind,
      to: kind === "chit" && !replyTo ? $("#to").value : null,
      reply_to: replyTo || null,
      subject: $("#subject").value,
      body: $("#body").value,
    });
    msg.textContent = r.status === "pending" ? "Sent! Waiting for chair approval." : "Sent!";
    $("#subject").value = ""; $("#body").value = "";
    clearReply();
    await refresh();
  } catch (x) { msg.className = "err"; msg.textContent = x.message; }
  finally { submit.disabled = false; }
});

async function enter(u) {
  me = u;
  clearInterval(pollTimer);
  $("#ec-login").hidden = true; $("#ec-app").hidden = false;
  $("#login-err").textContent = "";
  showStatus("");
  $("#who-name").textContent = u.name;
  $("#who-role").textContent = roleLabel(u);
  $("#who-code").textContent = u.code;
  clearReply();
  $("#tab-queue").hidden = u.role === "delegate";
  $("#kind").innerHTML = u.role === "delegate"
    ? `<option value="chit">Chit</option><option value="directive">Directive</option><option value="resolution">Resolution</option>`
    : `<option value="chit">Chit</option>`;
  updateKindHint();
  showTab("inbox");
  await loadDirectory();
  await refresh();
  if (me) pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 8000);
}

function leave() {
  me = null; clearInterval(pollTimer);
  clearReply();
  $("#ec-app").hidden = true; $("#ec-login").hidden = false;
  $("#code-input").value = "";
  showStatus("");
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-err"); err.textContent = "";
  const submit = $("button[type='submit']", e.currentTarget);
  submit.disabled = true;
  try { await enter(await api("/api/login", { code: $("#code-input").value.trim().toUpperCase() })); }
  catch (x) { leave(); err.textContent = x.message; }
  finally { submit.disabled = false; }
});
$("#code-input").addEventListener("input", (e) => {
  e.currentTarget.value = e.currentTarget.value.toUpperCase();
});
$("#logout").addEventListener("click", async () => {
  const button = $("#logout");
  button.disabled = true;
  try { await api("/api/logout", {}); leave(); }
  catch (e) { showStatus(e.message || "Unable to log out. Please try again.", true); }
  finally { button.disabled = false; }
});

(async () => {
  try {
    const r = await api("/api/me");
    if (r.user) await enter(r.user);
  } catch (e) {
    leave();
    $("#login-err").textContent = "Unable to connect to E-Chits. Please refresh and try again.";
  }
})();

/* =====================================================
   5. WELLNESS (saved on this device, resets daily)
   ===================================================== */
(function wellness() {
  const today = new Date();
  const localDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  const key = "dxbmun-wellness-" + localDate;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
  const boxes = $$("[data-w]");
  function count() { $("#well-count").textContent = `${boxes.filter((b) => b.checked).length} of ${boxes.length} checked today.`; }
  boxes.forEach((b) => {
    b.checked = !!saved[b.dataset.w];
    b.addEventListener("change", () => {
      saved[b.dataset.w] = b.checked;
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) {}
      count();
    });
  });
  count();
})();