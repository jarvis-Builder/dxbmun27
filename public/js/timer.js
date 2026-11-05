(function () {
  function $(id) { return document.getElementById(id); }
  var state = $('timer-state'), remainingDisplay = $('timer-remaining'), clock = document.querySelector('.timer-clock');
  var speakerAnnouncement = $('speaker-announcement');
  var minutes = $('timer-minutes'), seconds = $('timer-seconds');
  var presets = Array.prototype.slice.call(document.querySelectorAll('.timer-preset'));
  var total = 60, left = total, deadline = 0, interval = null, finished = false;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function format(value) { value = Math.max(0, Math.ceil(value)); return ('0' + Math.floor(value / 60)).slice(-2) + ':' + ('0' + (value % 60)).slice(-2); }
  function draw() { clock.classList.toggle('is-done', finished); }
  function stop(message) {
    clearInterval(interval);
    interval = null;
    if (message) state.textContent = message;
  }
  function tick() {
    left = Math.max(0, (deadline - Date.now()) / 1000);
    remainingDisplay.textContent = left && activeSpeaker
      ? 'Speaking: ' + activeSpeaker + ' · ' + format(left)
      : 'Time is up' + (activeSpeaker ? ' for ' + activeSpeaker : '') + '.';
    if (!left) {
      left = 0;
      finished = true;
      draw();
      stop('Time is up' + (activeSpeaker ? ' for ' + activeSpeaker : '') + '.');
    }
  }
  function makeWheel(box, initial, onChange) {
    var inner = box.querySelector('.timer-wheel-in');
    var items = [];
    var value = initial;
    var pos = initial, target = initial;
    var raf = 0, idle = 0, drag = null;
    var count = 60, step = 22, radius = 115, pixelsPerStep = 42;

    function mod(number) { return ((number % count) + count) % count; }
    function updateValue(next, notify) {
      next = mod(next);
      if (value === next) return;
      value = next;
      items.forEach(function (item, index) {
        item.setAttribute('aria-selected', String(index === value));
        item.classList.toggle('is-selected', index === value);
      });
      box.setAttribute('aria-activedescendant', items[value].id);
      box.setAttribute('aria-valuetext', ('0' + value).slice(-2));
      if (notify) onChange(value);
    }
    function render() {
      raf = 0;
      if (reduceMotion) pos = target;
      else pos += (target - pos) * 0.2;
      var settled = Math.abs(target - pos) < 0.002;
      if (settled) pos = target;

      items.forEach(function (item, index) {
        var distance = mod(index - pos);
        if (distance > count / 2) distance -= count;
        if (Math.abs(distance) > 5) {
          item.style.visibility = 'hidden';
          return;
        }
        item.style.visibility = 'visible';
        item.style.transform = 'rotateX(' + (-distance * step) + 'deg) translateZ(' + radius + 'px)';
        item.style.opacity = String(Math.max(0, 1 - Math.abs(distance) * 0.18));
        item.setAttribute('aria-selected', String(Math.abs(distance) < 0.5));
        item.classList.toggle('is-selected', Math.abs(distance) < 0.5);
      });
      box.setAttribute('aria-activedescendant', box.id + '-option-' + mod(Math.round(pos)));
      if (!settled) raf = requestAnimationFrame(render);
      else updateValue(Math.round(pos), true);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(render); }
    function moveTo(next, notify) {
      next = mod(next);
      var current = Math.round(target);
      var distance = mod(next - mod(current));
      if (distance > count / 2) distance -= count;
      target = current + distance;
      updateValue(next, notify);
      kick();
    }

    for (var i = 0; i < count; i++) {
      var option = document.createElement('div');
      option.id = box.id + '-option-' + i;
      option.className = 'timer-wheel-option';
      option.textContent = ('0' + i).slice(-2);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(i === initial));
      inner.appendChild(option);
      items.push(option);
    }

    box.addEventListener('keydown', function (event) {
      var direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 :
        event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      moveTo(Math.round(target) + direction, true);
    });
    box.addEventListener('wheel', function (event) {
      event.preventDefault();
      var delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      target += Math.max(-1.5, Math.min(1.5, delta / 110));
      clearTimeout(idle);
      idle = setTimeout(function () {
        target = Math.round(target);
        kick();
      }, 140);
      kick();
    }, { passive: false });

    box.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      var option = event.target.closest ? event.target.closest('.timer-wheel-option') : null;
      drag = { y: event.clientY, target: target, id: event.pointerId, moved: false, item: option ? items.indexOf(option) : -1, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    });
    box.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var distance = event.clientY - drag.y;
      if (!drag.moved && Math.abs(distance) > 6) {
        drag.moved = true;
        try { box.setPointerCapture(drag.id); } catch (error) {}
        box.classList.add('drag');
      }
      if (!drag.moved) return;
      var elapsed = event.timeStamp - drag.lastTime;
      if (elapsed > 0) drag.velocity = (event.clientY - drag.lastY) / elapsed;
      drag.lastY = event.clientY;
      drag.lastTime = event.timeStamp;
      target = drag.target - distance / pixelsPerStep;
      kick();
    });
    function endDrag() {
      if (!drag) return;
      var ended = drag;
      drag = null;
      box.classList.remove('drag');
      if (ended.moved) {
        var fling = Math.max(-8, Math.min(8, -ended.velocity * 220 / pixelsPerStep));
        target = Math.round(target + fling);
        kick();
      } else if (ended.item > -1) {
        var distance = mod(ended.item - mod(Math.round(target)));
        if (distance > count / 2) distance -= count;
        moveTo(Math.round(target) + distance, true);
      }
    }
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);

    updateValue(initial, false);
    box.setAttribute('aria-valuetext', ('0' + initial).slice(-2));
    kick();
    return function (next) { moveTo(next, true); };
  }

  function updateDuration() {
    total = minuteValue * 60 + secondValue;
    left = total;
    finished = false;
    draw();
    remainingDisplay.textContent = 'Time remaining: ' + format(total);
    presets.forEach(function (preset) {
      var active = +preset.dataset.duration === total;
      preset.classList.toggle('is-active', active);
      preset.setAttribute('aria-pressed', String(active));
    });
    state.textContent = total ? format(total) + ' selected. Ready when you are.' : 'Choose a duration greater than 00:00.';
  }

  var minuteValue = 1, secondValue = 0;
  var chooseMinute = makeWheel(minutes, minuteValue, function (value) {
    minuteValue = value;
    updateDuration();
  });
  var chooseSecond = makeWheel(seconds, secondValue, function (value) {
    secondValue = value;
    updateDuration();
  });

  presets.forEach(function (preset) {
    preset.addEventListener('click', function () {
      var duration = +preset.dataset.duration;
      chooseMinute(Math.floor(duration / 60));
      chooseSecond(duration % 60);
    });
  });

  var committeeSelect = $('speaker-committee');
  var speakerList = $('speaker-list');
  var speakerEmpty = $('speaker-empty');
  var editor = $('speaker-editor');
  var addForm = $('speaker-add-form');
  var addAllButton = $('speaker-add-all');
  var addHint = $('speaker-add-hint');
  var addSelect = $('speaker-add-select');
  var loginForm = $('speaker-login-form');
  var accessCode = $('speaker-access-code');
  var sessionBox = $('speaker-session');
  var userLabel = $('speaker-user');
  var message = $('speaker-message');
  var sessionControl = $('timer-session-control');
  var sessionModeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-session-mode]'));
  var chairHint = $('timer-chair-hint');
  var chairHintText = $('timer-chair-hint-text');
  var sessionStatus = $('timer-session-status');
  var sessionEnd = $('timer-session-end');
  var durationPicker = $('timer-duration-picker');
  var durationLabel = $('timer-duration-label');
  var caucusTotalPicker = $('caucus-total-picker');
  var caucusTotalMinutes = $('caucus-total-minutes');
  var sessionConfirm = $('timer-session-confirm');
  var sessionCancel = $('timer-session-cancel');
  var speakerPanelTitle = $('speaker-panel-title');
  var caucusTimerDisplay = $('caucus-timer-display');
  var caucusTimerClock = $('caucus-timer-clock');
  var caucusTimerState = $('caucus-timer-state');
  var caucusTimerKey = '';
  var caucusTimerDeadline = 0;
  var caucusTimerInterval = null;
  var selectedCommittee = '';
  var currentUser = null;
  var timerKey = '';
  var activeSpeaker = '';
  var loading = false;
  var listSignature = '';
  var pendingSessionMode = '';
  var pendingGeneralTimer = false;
  var generalTimerKey = '';
  var generalTimerDeadline = 0;
  var generalTimerRemaining = 0;
  var generalTimerRunning = false;
  var generalTimerInterval = null;
  var generalTimerClock = $('general-timer-clock');
  var generalTimerState = $('general-timer-state');
  var generalTimerStatus = $('general-timer-status');
  var generalTimerControls = $('general-timer-controls');
  var generalTimerSetup = $('general-timer-setup');
  var generalTimerPause = $('general-timer-pause');
  var generalTimerResume = $('general-timer-resume');
  var generalTimerReset = $('general-timer-reset');
  function showMessage(text, isError) {
    message.textContent = text || '';
    message.classList.toggle('is-error', !!isError);
  }
  function api(url, options) {
    options = options || {};
    options.credentials = 'same-origin';
    if (options.body) options.headers = { 'Content-Type': 'application/json' };
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
        return data;
      });
    });
  }
  function selectedDuration() { return minuteValue * 60 + secondValue; }
  function tickGeneralTimer() {
    generalTimerRemaining = Math.max(0, (generalTimerDeadline - Date.now()) / 1000);
    generalTimerClock.textContent = format(generalTimerRemaining);
    if (!generalTimerRemaining) {
      generalTimerRunning = false;
      clearInterval(generalTimerInterval);
      generalTimerInterval = null;
      generalTimerState.textContent = 'Time is up';
      generalTimerStatus.textContent = 'Timer finished.';
      generalTimerPause.hidden = true;
      generalTimerResume.hidden = true;
    }
  }
  function syncGeneralTimer(timer, serverNow) {
    if (!timer) {
      generalTimerKey = '';
      generalTimerRunning = false;
      generalTimerRemaining = 0;
      clearInterval(generalTimerInterval);
      generalTimerInterval = null;
      generalTimerClock.textContent = '--:--';
      generalTimerState.textContent = 'No timer running';
      generalTimerStatus.textContent = 'No timer is active.';
      generalTimerControls.hidden = true;
      generalTimerSetup.hidden = !currentUser || currentUser.role !== 'chair';
      return;
    }
    var key = [timer.running, timer.started_at, timer.duration, timer.running ? '' : timer.remaining].join(':');
    if (key !== generalTimerKey) {
      generalTimerKey = key;
      generalTimerRunning = !!timer.running;
      generalTimerRemaining = timer.remaining;
      if (generalTimerRunning) {
        generalTimerDeadline = Date.now() + Math.max(0, timer.duration - (serverNow - timer.started_at)) * 1000;
        clearInterval(generalTimerInterval);
        generalTimerInterval = setInterval(tickGeneralTimer, 200);
      } else {
        clearInterval(generalTimerInterval);
        generalTimerInterval = null;
      }
    }
    generalTimerClock.textContent = format(generalTimerRunning
      ? Math.max(0, (generalTimerDeadline - Date.now()) / 1000)
      : generalTimerRemaining);
    generalTimerState.textContent = generalTimerRunning
      ? 'Timer running'
      : generalTimerRemaining
        ? 'Timer paused'
        : 'Time is up';
    generalTimerStatus.textContent = generalTimerRunning
      ? 'Timer running.'
      : generalTimerRemaining
        ? 'Timer paused with ' + format(generalTimerRemaining) + ' remaining.'
        : 'Timer finished.';
    generalTimerControls.hidden = !currentUser || currentUser.role !== 'chair';
    generalTimerSetup.hidden = generalTimerRunning || generalTimerRemaining > 0;
    generalTimerPause.hidden = !generalTimerRunning;
    generalTimerResume.hidden = generalTimerRunning || !generalTimerRemaining;
  }
  function generalTimerRequest(action, duration) {
    var payload = { action: action };
    if (duration !== undefined) payload.duration = duration;
    return api('/api/speakers/general-timer', {
      method: 'POST', body: JSON.stringify(payload)
    }).then(function () {
      return loadSpeakers(false).then(function () { return true; });
    }).catch(function (error) {
      showMessage(error.message, true);
      return false;
    });
  }
  function tickCaucusTimer() {
    var remaining = Math.max(0, (caucusTimerDeadline - Date.now()) / 1000);
    caucusTimerClock.textContent = format(remaining);
    if (!remaining) {
      clearInterval(caucusTimerInterval);
      caucusTimerInterval = null;
      caucusTimerState.textContent = 'Caucus time is up';
    }
  }
  function syncCaucusTimer(session, serverNow, sessionFinished) {
    if (!session || !session.total_duration) {
      caucusTimerKey = '';
      caucusTimerDisplay.hidden = true;
      clearInterval(caucusTimerInterval);
      caucusTimerInterval = null;
      caucusTimerClock.textContent = '--:--';
      caucusTimerState.textContent = sessionFinished ? 'Caucus time is up' : 'No caucus timer';
      return;
    }
    var key = session.started_at + ':' + session.total_duration;
    if (key !== caucusTimerKey) {
      caucusTimerKey = key;
      caucusTimerDeadline = Date.now() + Math.max(0, session.total_remaining) * 1000;
      clearInterval(caucusTimerInterval);
      caucusTimerInterval = setInterval(tickCaucusTimer, 200);
    }
    caucusTimerDisplay.hidden = false;
    caucusTimerClock.textContent = format(Math.max(0, (caucusTimerDeadline - Date.now()) / 1000));
    caucusTimerState.textContent = session.mode === 'moderated_caucus'
      ? 'Moderated caucus total time'
      : 'Unmoderated caucus total time';
  }
  function syncTimer(timer, serverNow, session) {
    if (!timer) {
      speakerAnnouncement.hidden = true;
      speakerAnnouncement.textContent = '';
      if (timerKey) {
        stop(session ? 'Waiting for the chair to start a delegate timer.' : 'The speaking format has ended.');
        finished = false;
        draw();
      }
      timerKey = '';
      activeSpeaker = '';
      remainingDisplay.textContent = 'No active speaker timer.';
      if (session) state.textContent = 'The chair can start a delegate from the speaking list.';
      return;
    }
    var speechLabel = session && session.mode === 'gsl'
      ? 'a GSL Speech'
      : session && session.mode === 'moderated_caucus'
        ? 'a Moderated Caucus Speech'
        : '';
    speakerAnnouncement.hidden = !speechLabel || !timer.remaining || !timer.country;
    speakerAnnouncement.textContent = speakerAnnouncement.hidden
      ? ''
      : timer.country + ' is giving ' + speechLabel;
    var key = timer.started_at + ':' + timer.speaker + ':' + timer.duration;
    if (key !== timerKey) {
      timerKey = key;
      activeSpeaker = timer.speaker;
      total = timer.duration;
      left = Math.max(0, timer.started_at + timer.duration - serverNow);
      deadline = Date.now() + left * 1000;
      finished = left === 0;
      draw();
      if (left > 0) {
        clearInterval(interval);
        interval = setInterval(tick, 200);
      } else {
        stop('Time is up for ' + timer.speaker + '.');
      }
    }
    remainingDisplay.textContent = timer.remaining
      ? 'Speaking: ' + timer.speaker + ' · ' + format(Math.max(0, deadline - Date.now()) / 1000)
      : 'Time is up for ' + timer.speaker + '.';
    if (timer.remaining) state.textContent = 'Timer started by the chair.';
  }
  function formatName(mode) {
    return {
      gsl: 'General Speakers List (GSL)',
      moderated_caucus: 'Moderated Caucus',
      unmoderated_caucus: 'Unmoderated Caucus'
    }[mode] || mode;
  }
  function makeButton(text, action, callback, disabled) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn ghost sm';
    button.textContent = text;
    button.disabled = !!disabled;
    button.addEventListener('click', callback);
    action.appendChild(button);
  }
  function postEdit(payload) {
    payload.committee = selectedCommittee;
    return api('/api/speakers', {
      method: 'POST', body: JSON.stringify(payload)
    }).then(function (result) {
      showMessage(payload.action === 'add_all'
        ? result.added
          ? result.added + ' delegate' + (result.added === 1 ? '' : 's') + ' added to the speaking order.'
          : 'All delegates are already on the speaking order.'
        : 'Speaking list updated.');
      return loadSpeakers(false);
    }).catch(function (error) {
      showMessage(error.message, true);
    });
  }
  function renderSpeakers(data) {
    if (!committeeSelect.options.length || committeeSelect.options.length !== data.committees.length) {
      committeeSelect.textContent = '';
      data.committees.forEach(function (committee) {
        var option = document.createElement('option');
        option.value = committee;
        option.textContent = committee;
        committeeSelect.appendChild(option);
      });
    }
    selectedCommittee = data.committee;
    committeeSelect.value = selectedCommittee;
    currentUser = data.user;
    committeeSelect.disabled = !!(currentUser && currentUser.role === 'chair');
    var canEdit = currentUser && currentUser.role === 'chair';
    var canStart = currentUser && currentUser.role === 'chair';
    editor.hidden = !canEdit;
    sessionControl.hidden = false;
    sessionModeButtons.forEach(function (button) {
      button.disabled = !canStart;
    });
    chairHint.hidden = !!canStart;
    chairHintText.textContent = currentUser
      ? 'Only a chair can start a speaking format. Sign out and use a chair access code.'
      : 'Chair sign-in is required to start a speaking format.';
    loginForm.hidden = !!currentUser;
    sessionBox.hidden = !currentUser;
    var session = data.session;
    var canAdd = !!canEdit && !!session &&
      (session.mode === 'gsl' || session.mode === 'moderated_caucus');
    addHint.hidden = canAdd;
    addHint.textContent = !session
      ? 'Start GSL or a moderated caucus before adding delegates to the list.'
      : 'The speaking list is not used during an unmoderated caucus.';
    addAllButton.disabled = !canAdd || !data.eligible.length;
    addSelect.disabled = !canAdd || !data.eligible.length;
    addForm.querySelector('button[type="submit"]').disabled = !canAdd || !data.eligible.length;
    sessionStatus.textContent = data.session_finished
      ? 'Caucus time is up.'
      : !session
        ? 'No speaking format is active. Choose a format and set its time.'
        : session.mode === 'gsl'
          ? 'General Speakers List is active · ' + format(session.duration) + ' per speech.'
          : session.mode === 'moderated_caucus'
            ? 'Moderated Caucus is active · ' + format(session.total_duration) +
              ' total, ' + format(session.duration) + ' per speech.'
            : 'Unmoderated Caucus is active · ' + format(session.total_duration) + ' total.';
    speakerPanelTitle.textContent = session && session.mode === 'moderated_caucus'
      ? 'Moderated Caucus Speaking List'
      : 'General Speakers List';
    speakerPanelTitle.hidden = !!(session && session.mode === 'unmoderated_caucus');
    speakerList.hidden = !!(session && session.mode === 'unmoderated_caucus');
    speakerEmpty.hidden = data.queue.length !== 0 ||
      !!(session && session.mode === 'unmoderated_caucus');
    editor.hidden = !canEdit || !!(session && session.mode === 'unmoderated_caucus');
    sessionEnd.hidden = !canStart || !session;
    if (!canStart || (!pendingSessionMode && !pendingGeneralTimer)) durationPicker.hidden = true;
    generalTimerSetup.hidden = !canStart || generalTimerRunning || generalTimerRemaining > 0;
    if (!canStart) pendingSessionMode = '';
    if (!pendingSessionMode && !pendingGeneralTimer) {
      durationLabel.textContent = '2 · Choose a speaking format first';
    }
    caucusTotalPicker.hidden = pendingSessionMode !== 'moderated_caucus';
    userLabel.textContent = currentUser
      ? currentUser.name + ' · ' + currentUser.role + (currentUser.committee ? ' · ' + currentUser.committee : '')
      : '';
    if (currentUser && !canEdit) {
      showMessage('Only the committee chair can edit the speaking order.');
    } else if (canEdit) {
      showMessage('');
    }

    speakerList.textContent = '';
    data.queue.forEach(function (speaker, index) {
      var row = document.createElement('li');
      row.className = 'speaker-row';
      var info = document.createElement('span');
      info.className = 'speaker-info';
      var name = document.createElement('strong');
      name.textContent = speaker.name;
      info.appendChild(name);
      var speakingTime = document.createElement('small');
      if (session) {
        speakingTime.textContent = 'Common speaking time: ' + format(session.duration);
        info.appendChild(speakingTime);
      }
      if (speaker.country) {
        var country = document.createElement('small');
        country.textContent = speaker.country;
        info.appendChild(country);
      }
      row.appendChild(info);
      if (canEdit || canStart) {
        var actions = document.createElement('span');
        actions.className = 'speaker-row-actions';
        if (canEdit) {
          makeButton('Move up', actions, function () {
            postEdit({ action: 'move', speaker_id: speaker.id, direction: 'up' });
          }, index === 0);
          makeButton('Move down', actions, function () {
            postEdit({ action: 'move', speaker_id: speaker.id, direction: 'down' });
          }, index === data.queue.length - 1);
          makeButton('Remove', actions, function () {
            postEdit({ action: 'remove', speaker_id: speaker.id });
          });
        }
        if (canStart) {
          makeButton('Start timer', actions, function () {
            if (!session) {
              showMessage('The chair must start a speaking format first.', true);
              return;
            }
            api('/api/speakers/timer', {
              method: 'POST',
              body: JSON.stringify({ speaker_id: speaker.id })
            }).then(function () {
              showMessage('Timer started for ' + speaker.name + ' (' + format(session.duration) + ').');
              return loadSpeakers(false);
            }).catch(function (error) {
              showMessage(error.message, true);
            });
          }, !session);
        }
        row.appendChild(actions);
      }
      speakerList.appendChild(row);
    });

    addSelect.textContent = '';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = data.eligible.length ? 'Choose a delegate' : 'No delegates available';
    placeholder.disabled = true;
    placeholder.selected = true;
    addSelect.appendChild(placeholder);
    data.eligible.forEach(function (delegate) {
      var option = document.createElement('option');
      option.value = delegate.id;
      option.textContent = delegate.name + (delegate.country ? ' · ' + delegate.country : '');
      addSelect.appendChild(option);
    });
    syncTimer(data.timer, data.server_now, session);
    syncGeneralTimer(data.general_timer, data.server_now);
    syncCaucusTimer(session, data.server_now, data.session_finished);
  }
  function loadSpeakers(reportError) {
    if (loading) return Promise.resolve();
    loading = true;
    var path = '/api/speakers' + (selectedCommittee ? '?committee=' + encodeURIComponent(selectedCommittee) : '');
    return api(path).then(function (data) {
      var signature = JSON.stringify([
        data.committee, data.queue, data.eligible, data.user, data.session, data.session_finished
      ]);
      if (signature !== listSignature) {
        listSignature = signature;
        renderSpeakers(data);
      } else {
        syncTimer(data.timer, data.server_now, data.session);
      }
      syncGeneralTimer(data.general_timer, data.server_now);
      syncCaucusTimer(data.session, data.server_now, data.session_finished);
    }).catch(function (error) {
      if (reportError !== false || !message.textContent) showMessage(error.message, true);
      state.textContent = error.message;
      console.error('Unable to load the speaking list:', error);
    }).finally(function () {
      loading = false;
    });
  }

  committeeSelect.addEventListener('change', function () {
    selectedCommittee = committeeSelect.value;
    showMessage('');
    loadSpeakers(true);
  });
  addForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!addSelect.value) return;
    postEdit({ action: 'add', delegate_id: addSelect.value });
  });
  addAllButton.addEventListener('click', function () {
    postEdit({ action: 'add_all' });
  });
  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    showMessage('');
    api('/api/login', {
      method: 'POST', body: JSON.stringify({ code: accessCode.value })
    }).then(function (user) {
      if (user.role === 'chair' || user.role === 'delegate') selectedCommittee = user.committee;
      accessCode.value = '';
      showMessage('Signed in.');
      return loadSpeakers(true);
    }).catch(function (error) {
      showMessage(error.message, true);
    });
  });
  $('speaker-logout').addEventListener('click', function () {
    api('/api/logout', { method: 'POST' }).then(function () {
      currentUser = null;
      showMessage('Signed out.');
      return loadSpeakers(true);
    }).catch(function (error) {
      showMessage(error.message, true);
    });
  });
  sessionModeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      pendingSessionMode = button.dataset.sessionMode;
      pendingGeneralTimer = false;
      durationPicker.hidden = false;
      caucusTotalPicker.hidden = pendingSessionMode !== 'moderated_caucus';
      if (pendingSessionMode === 'gsl') {
        durationLabel.textContent = '2 · Set the common speaking time per delegate';
        sessionConfirm.textContent = 'Start GSL';
        showMessage('Choose the GSL time allowed for each speech.');
      } else if (pendingSessionMode === 'moderated_caucus') {
        durationLabel.textContent = '2 · Set speaking time per delegate';
        sessionConfirm.textContent = 'Start moderated caucus';
        showMessage('Set the per-speech time and the total moderated caucus time.');
      } else {
        durationLabel.textContent = '2 · Set total unmoderated caucus time';
        sessionConfirm.textContent = 'Start unmoderated caucus';
        showMessage('Choose the total unmoderated caucus time.');
      }
    });
  });
  generalTimerSetup.addEventListener('click', function () {
    pendingGeneralTimer = true;
    pendingSessionMode = '';
    durationPicker.hidden = false;
    caucusTotalPicker.hidden = true;
    durationLabel.textContent = 'Set the timer duration';
    sessionConfirm.textContent = 'Start timer';
    sessionCancel.textContent = 'Cancel';
    showMessage('Choose a duration for the timer.');
  });
  sessionConfirm.addEventListener('click', function () {
      if (pendingGeneralTimer) {
        var generalDuration = selectedDuration();
        if (!generalDuration) {
          showMessage('Choose a timer duration greater than 00:00.', true);
          return;
        }
        return generalTimerRequest('start', generalDuration).then(function (started) {
          if (!started) return;
          pendingGeneralTimer = false;
          durationPicker.hidden = true;
          sessionConfirm.textContent = 'Start selected format';
          showMessage('Timer started for ' + format(generalDuration) + '.');
        });
      }
      if (!pendingSessionMode) {
        showMessage('Choose a speaking format first.', true);
        return;
      }
      var duration = selectedDuration();
      if (!duration) {
        showMessage('Choose a duration greater than 00:00.', true);
        return;
      }
      var mode = pendingSessionMode;
      var payload = { mode: mode };
      if (mode === 'gsl') {
        payload.duration = duration;
      } else if (mode === 'moderated_caucus') {
        var totalMinutes = Number(caucusTotalMinutes.value);
        if (!Number.isInteger(totalMinutes) || totalMinutes < 1 || totalMinutes > 60) {
          showMessage('Total moderated caucus time must be between 1 and 60 minutes.', true);
          return;
        }
        payload.duration = duration;
        payload.total_duration = totalMinutes * 60;
      } else {
        payload.total_duration = duration;
      }
      api('/api/speakers/session', {
        method: 'POST',
        body: JSON.stringify(payload)
      }).then(function () {
        pendingSessionMode = '';
        durationPicker.hidden = true;
        caucusTotalPicker.hidden = true;
        showMessage(formatName(mode) + ' started.');
        return loadSpeakers(false);
      }).catch(function (error) {
        showMessage(error.message, true);
      });
  });
  sessionCancel.addEventListener('click', function () {
    pendingSessionMode = '';
    pendingGeneralTimer = false;
    durationPicker.hidden = true;
    caucusTotalPicker.hidden = true;
    sessionConfirm.textContent = 'Start selected format';
    showMessage('');
  });
  generalTimerPause.addEventListener('click', function () {
    generalTimerRequest('pause');
  });
  generalTimerResume.addEventListener('click', function () {
    generalTimerRequest('resume');
  });
  generalTimerReset.addEventListener('click', function () {
    generalTimerRequest('reset');
  });
  sessionEnd.addEventListener('click', function () {
    api('/api/speakers/session', {
      method: 'POST', body: JSON.stringify({ mode: 'end' })
    }).then(function () {
      showMessage('Speaking format ended.');
      return loadSpeakers(false);
    }).catch(function (error) {
      showMessage(error.message, true);
    });
  });
  window.setInterval(function () { loadSpeakers(false); }, 3000);
  loadSpeakers(true);
  draw();
})();
