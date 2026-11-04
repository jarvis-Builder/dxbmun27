(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(String.fromCharCode(34), "&quot;").replaceAll(String.fromCharCode(39), "&#39;");
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

})();
