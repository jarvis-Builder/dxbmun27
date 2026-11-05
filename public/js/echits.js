(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(String.fromCharCode(34), "&quot;").replaceAll(String.fromCharCode(39), "&#39;");
/* =====================================================
   4. E-CHITS
   ===================================================== */
let me = null, pollTimer = null, welcomeTimeout = null;
const ROLE_NAME = { delegate: "Delegate", chair: "Chair", admin: "Admin" };
const selectedKind = () => $('input[name="kind"]:checked').value;
let lastKind = "chit";

async function api(path, body) {
  const opt = body === undefined ? {} : body instanceof FormData
    ? { method: "POST", body }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
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

function showWelcome(name) {
  const welcome = $("#echits-welcome");
  clearTimeout(welcomeTimeout);
  welcome.textContent = `Welcome ${name}`;
  welcome.hidden = false;
  welcomeTimeout = setTimeout(() => {
    welcome.hidden = true;
  }, 2000);
}

const roleLabel = (u) => {
  if (u.role === "delegate") {
    return [u.country ? `<strong>${esc(u.country)}</strong>` : "", "Delegate", esc(u.committee)].filter(Boolean).join(" · ");
  }
  if (u.role === "chair") return ["Chair", esc(u.committee)].filter(Boolean).join(" · ");
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
  if (name === "chit-history" && me?.role === "chair") {
    refreshChitHistory().catch((error) => showStatus(error.message || "Unable to load chit history.", true));
  }
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

function personLabel(name, country, role, includeName) {
  const identity = country
    ? `<strong>${esc(country)}</strong>`
    : esc(ROLE_NAME[role] || "User");
  return includeName ? `${identity} · ${esc(name || "—")}` : identity;
}

function msgCard(m, mode) {
  const when = new Date(m.created * 1000).toLocaleString();
  const includeNames = mode === "queue" && me?.role === "chair";
  const sender = personLabel(m.sname, m.scountry, m.srole, includeNames);
  const typeLabel = m.kind === "chit"
    ? m.subtype === "poi" ? "POI" : "CHIT"
    : m.kind.toUpperCase();
  const detail = m.kind === "chit" && m.subtype
    ? m.subtype === "poi" ? "POI" : "Other"
    : m.kind === "directive" && m.visibility ? m.visibility : "";
  const route = mode === "sent"
    ? `To: ${personLabel(m.rname, m.rcountry, m.rrole, false)}`
    : mode === "history"
      ? `From: ${sender} → To: ${personLabel(m.rname, m.rcountry, m.rrole, false)}`
    : `From: ${sender}` + (mode === "queue" ? ` → To: ${personLabel(m.rname, m.rcountry, m.rrole, includeNames)}` : "");
  const metadata = mode === "in" && m.kind === "chit"
    ? `<div class="meta msg-sender">From: ${sender}</div><div class="meta">${esc(when)}</div>`
    : `<div class="meta">${route} · ${esc(when)}</div>`;
  const attachment = m.document_url
    ? `<p class="attachment-link"><a href="${esc(m.document_url)}" target="_blank" rel="noopener noreferrer">Open Google Docs/Drive document</a></p>`
    : m.attachment_name
      ? `<p class="attachment-link"><a href="/api/messages/${m.id}/attachment">Download ${esc(m.attachment_name)}</a></p>`
      : "";
  const actions = mode === "queue"
    ? `<div class="actions">
         <input placeholder="Optional note to sender">
         <button class="btn gold" data-act="approve">Approve</button>
         <button class="btn red" data-act="reject">Reject</button>
       </div>` : "";
  const replyAction = mode === "in" && m.kind === "chit"
    ? `<button type="button" class="btn gold reply-btn" data-reply="${m.id}">Reply</button>` : "";
  return `<div class="msg" data-id="${m.id}">
    <div class="msg-top"><span class="msg-type msg-type-${esc(m.kind)}">${esc(typeLabel)}</span>${detail && detail !== typeLabel ? `<span class="tag">${esc(detail)}</span>` : ""}<span class="tag ${esc(m.status)}">${esc(m.status)}</span></div>
    <h4>${esc(m.subject)}</h4>
    ${metadata}
    <div class="body">${esc(m.body)}</div>
    ${attachment}
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
      $("#cnt-queue").textContent = box.queue.length;
      const panel = $('[data-panel="queue"]');
      if (!document.activeElement.matches("#panel-queue input")) {   // don't wipe a note you're typing
        panel.innerHTML = box.queue.map((m) => msgCard(m, "queue")).join("") || empty("Nothing waiting for approval.");
      }
    }
    if (me.role === "chair" && $("#tab-chit-history").getAttribute("aria-selected") === "true") {
      await refreshChitHistory();
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

$("[data-panel='chit-history']").addEventListener("change", (event) => {
  if (event.target.id !== "chit-history-delegate" || !me || me.role !== "chair") return;
  refreshChitHistory().catch((error) => showStatus(error.message || "Unable to load chit history.", true));
});

async function refreshChitHistory() {
  const select = $("#chit-history-delegate");
  const selectedId = select.value;
  const history = await api("/api/chit-history" + (selectedId ? `?delegate_id=${encodeURIComponent(selectedId)}` : ""));
  if (select.options.length !== history.delegates.length + 1
      || history.delegates.some((delegate, index) => {
        const option = select.options[index + 1];
        const label = delegate.country || "Country not provided";
        return !option || option.value !== String(delegate.id) || option.textContent !== label;
      })) {
    select.innerHTML = `<option value="">Choose a delegate</option>` + history.delegates.map((delegate) =>
      `<option value="${esc(delegate.id)}">${esc(delegate.country || "Country not provided")}</option>`
    ).join("");
    if (history.delegates.some((delegate) => String(delegate.id) === selectedId)) select.value = selectedId;
  }
  $("#chit-history-messages").innerHTML = history.messages.map((message) => msgCard(message, "history")).join("")
    || empty(select.value ? "No chit history for this delegate yet." : "Select a delegate to view their chit history.");
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
  $('input[name="kind"][value="chit"]').checked = true;
  $("#kind-options").disabled = true;
  $("#to-wrap").hidden = true;
  $("#subject").value = (/^re:/i.test(subject) ? subject : `Re: ${subject}`).slice(0, 120);
  $("#body").value = "";
  $("#send-msg").textContent = "";
  $("#send-msg").className = "ok";
  updateKindHint();
  showTab("compose");
  $("#body").focus();
});

async function loadDirectory() {
  const people = await api("/api/directory");
  $("#to").innerHTML = people.length
    ? people.map((p) => {
      const details = [p.country || ROLE_NAME[p.role], p.committee].filter(Boolean).join(" · ");
      return `<option value="${p.id}">${esc(details)}</option>`;
    }).join("")
    : `<option value="" disabled selected>No recipients available</option>`;
}

function updateKindHint() {
  const k = selectedKind();
  const replying = Boolean($("#reply-to-id").value);
  $("#chit-options").hidden = k !== "chit";
  $("#resolution-attachment").hidden = k !== "resolution" || me.role !== "delegate";
  $("#to-wrap").hidden = k !== "chit" || replying;
  const visibility = $('input[name="visibility"]:checked');
  $("#kind-hint").textContent = replying ? "Your reply will be sent to the original sender in your committee."
    : k === "chit" ? (me.role === "delegate" ? "You can send chits only to people in your committee. Chits to other delegates are checked by your chair." : "Delivered instantly.")
    : k === "directive" && visibility && visibility.value === "public"
      ? "After chair approval, everyone will be able to see this directive."
      : k === "directive" ? "Only you and your chair will be able to see this directive."
      : "Goes to your chair for approval.";
}
$("#kind-options").addEventListener("change", () => {
  if (selectedKind() === "directive") {
    $("#directive-dialog").showModal();
  } else {
    lastKind = selectedKind();
    updateKindHint();
  }
});
$$('#directive-options input[name="visibility"]').forEach((input) => {
  input.addEventListener("click", () => {
    input.checked = true;
    $("#directive-dialog").close();
    updateKindHint();
    $("#subject").focus();
  });
});
function cancelDirectiveSelection() {
  $(`input[name="kind"][value="${lastKind}"]`).checked = true;
  $("#directive-dialog").close();
  updateKindHint();
}
$("#directive-cancel").addEventListener("click", cancelDirectiveSelection);
$("#directive-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelDirectiveSelection();
});

function clearReply() {
  $("#reply-to-id").value = "";
  $("#kind-options").disabled = false;
  if (me) updateKindHint();
}

$("#compose-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#send-msg"); msg.textContent = ""; msg.className = "ok";
  const submit = $("button[type='submit']", e.currentTarget);
  submit.disabled = true;
  try {
    const kind = selectedKind();
    const replyTo = $("#reply-to-id").value;
    const payload = {
      kind,
      to: kind === "chit" && !replyTo ? $("#to").value : null,
      reply_to: replyTo || null,
      subtype: kind === "chit" ? $('input[name="chit_type"]:checked').value : null,
      visibility: kind === "directive" ? $('input[name="visibility"]:checked').value : null,
      doc_url: kind === "resolution" ? $("#resolution-url").value : null,
      subject: $("#subject").value,
      body: $("#body").value,
    };
    const file = $("#resolution-file").files[0];
    let requestBody = payload;
    if (kind === "resolution" && file) {
      requestBody = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== null && value !== "") requestBody.append(key, value);
      });
      requestBody.append("document", file);
    }
    const r = await api("/api/send", requestBody);
    msg.textContent = r.status === "pending" ? "Sent! Waiting for chair approval." : "Sent!";
    $("#subject").value = ""; $("#body").value = "";
    $("#resolution-url").value = "";
    $("#resolution-file").value = "";
    clearReply();
    if (kind === "directive") {
      $('input[name="kind"][value="chit"]').checked = true;
      lastKind = "chit";
      updateKindHint();
    }
    await refresh();
  } catch (x) { msg.className = "err"; msg.textContent = x.message; }
  finally { submit.disabled = false; }
});

async function enter(u) {
  me = u;
  clearInterval(pollTimer);
  showWelcome(u.name);
  $("#ec-login").hidden = true; $("#ec-app").hidden = false;
  $("#login-err").textContent = "";
  showStatus("");
  $("#who-name").textContent = "Signed in";
  $("#who-role").innerHTML = roleLabel(u);
  $("#who-code").textContent = u.code;
  clearReply();
  lastKind = "chit";
  $("#tab-queue").hidden = u.role === "delegate";
  $("#queue-label").textContent = u.role === "admin" ? "All approvals" : "Approvals";
  $("#tab-chit-history").hidden = u.role !== "chair";
  $$('#kind-options input[name="kind"]').forEach((input) => {
    input.closest("label").hidden = u.role !== "delegate" && input.value !== "chit";
  });
  $('input[name="kind"][value="chit"]').checked = true;
  updateKindHint();
  showTab("inbox");
  await loadDirectory();
  await refresh();
  if (me) pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 8000);
}

function leave() {
  me = null; clearInterval(pollTimer);
  if ($("#directive-dialog").open) $("#directive-dialog").close();
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
    $("#login-err").textContent = e.message || "Unable to connect to E-Chits. Please refresh and try again.";
  }
})();

})();
