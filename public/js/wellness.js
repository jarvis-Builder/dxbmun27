(function () {
  var checks = [].slice.call(document.querySelectorAll('[data-wellness]'));
  var status = document.getElementById('wellness-status');
  var note = document.getElementById('wellness-note');
  var storageKey = 'dxb-mun-wellness-checkin';
  var todayDate = new Date();
  var today = todayDate.getFullYear() + '-' +
    ('0' + (todayDate.getMonth() + 1)).slice(-2) + '-' +
    ('0' + todayDate.getDate()).slice(-2);
  function update() {
    var completed = checks.filter(function (check) { return check.checked; }).length;
    checks.forEach(function (check) {
      check.closest('.wellness-item').classList.toggle('is-checked', check.checked);
    });
    status.textContent = completed + ' of ' + checks.length + ' checked today.';
  }

  try {
    var saved = localStorage.getItem(storageKey);
    if (saved) {
      var progress = JSON.parse(saved);
      if (progress.date === today && Array.isArray(progress.checks)) {
        checks.forEach(function (check) {
          check.checked = progress.checks.indexOf(check.dataset.wellness) !== -1;
        });
      } else {
        localStorage.removeItem(storageKey);
      }
    }
  } catch (error) {
    note.textContent = 'Could not load check-in; changes may not save.';
  }

  checks.forEach(function (check) {
    check.addEventListener('change', function () {
      update();
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          date: today,
          checks: checks.filter(function (item) { return item.checked; }).map(function (item) {
            return item.dataset.wellness;
          })
        }));
        note.textContent = 'Saved on this device for today.';
      } catch (error) {
        note.textContent = 'Browser storage unavailable; check-in will not persist.';
      }
    });
  });

  update();
})();
