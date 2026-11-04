(function () {
  function $(id) { return document.getElementById(id); }
  var start = $('timer-start'), reset = $('timer-reset');
  var state = $('timer-state'), remainingDisplay = $('timer-remaining'), clock = document.querySelector('.timer-clock');
  var minutes = $('timer-minutes'), seconds = $('timer-seconds');
  var presets = Array.prototype.slice.call(document.querySelectorAll('.timer-preset'));
  var total = 60, left = total, running = false, deadline = 0, interval = null, finished = false;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function format(value) { value = Math.max(0, Math.ceil(value)); return ('0' + Math.floor(value / 60)).slice(-2) + ':' + ('0' + (value % 60)).slice(-2); }
  function draw() { clock.classList.toggle('is-done', finished); }
  function stop(message) {
    running = false;
    clearInterval(interval);
    interval = null;
    start.textContent = 'Start';
    minutes.setAttribute('aria-disabled', 'false');
    seconds.setAttribute('aria-disabled', 'false');
    minutes.tabIndex = 0;
    seconds.tabIndex = 0;
    presets.forEach(function (preset) { preset.disabled = false; });
    if (message) state.textContent = message;
  }
  function tick() {
    left = Math.max(0, (deadline - Date.now()) / 1000);
    remainingDisplay.textContent = 'Time remaining: ' + format(left);
    syncWheels(left);
    if (!left) {
      left = 0;
      finished = true;
      draw();
      stop('Time is up.');
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
      if (!running) moveTo(Math.round(target) + direction, true);
    });
    box.addEventListener('wheel', function (event) {
      event.preventDefault();
      if (running) return;
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
      if (running || (event.button !== undefined && event.button !== 0)) return;
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
    if (running) return;
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

  function syncWheels(value) {
    var remaining = Math.max(0, Math.ceil(value));
    var minute = Math.floor(remaining / 60);
    var second = remaining % 60;
    if (minute !== minuteValue) chooseMinute(minute);
    if (second !== secondValue) chooseSecond(second);
  }

  presets.forEach(function (preset) {
    preset.addEventListener('click', function () {
      if (running) return;
      var duration = +preset.dataset.duration;
      chooseMinute(Math.floor(duration / 60));
      chooseSecond(duration % 60);
    });
  });

  start.addEventListener('click', function () {
    if (running) {
      left = Math.max(0, (deadline - Date.now()) / 1000);
      syncWheels(left);
      stop('Paused.');
      state.textContent = 'Paused at ' + format(left) + '.';
      return;
    }
    if (!left) {
      left = total;
      syncWheels(total);
    }
    if (!left) {
      state.textContent = 'Choose a duration greater than 00:00.';
      return;
    }
    finished = false;
    draw();
    running = true;
    deadline = Date.now() + left * 1000;
    start.textContent = 'Pause';
    minutes.setAttribute('aria-disabled', 'true');
    seconds.setAttribute('aria-disabled', 'true');
    minutes.tabIndex = -1;
    seconds.tabIndex = -1;
    presets.forEach(function (preset) { preset.disabled = true; });
    state.textContent = 'Time is running.';
    tick();
    interval = setInterval(tick, 200);
  });
  reset.addEventListener('click', function () {
    if (running) stop();
    left = total;
    finished = false;
    syncWheels(total);
    remainingDisplay.textContent = 'Time remaining: ' + format(total);
    stop('Reset and ready.');
    draw();
  });
  remainingDisplay.textContent = 'Time remaining: ' + format(total);
  draw();
})();
