/* ══════════════════════════════════════════════════════════════
   CalmDriver — obsługa formularzy na stronach docelowych.
   Każdy <form class="lp-form"> wysyła POST /api/contact.
   API wymaga: name, phone, interest. Reszta pól jest opcjonalna.
   Ukryte pole "source" dopisujemy do wiadomości, żeby w mailu
   było widać, z której strony przyszło zgłoszenie.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  document.querySelectorAll('form.lp-form').forEach(function (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      const btn = form.querySelector('[type="submit"]');
      const msg = form.querySelector('.form-msg');
      const original = btn ? btn.innerHTML : '';
      const body = Object.fromEntries(new FormData(form).entries());

      // źródło zgłoszenia dopisane do treści wiadomości
      const source = form.dataset.source || document.title;
      body.message = body.message
        ? body.message + '\n\n— zgłoszenie ze strony: ' + source
        : 'Zgłoszenie ze strony: ' + source;

      if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Wysyłanie…';
      }
      if (msg) {
        msg.className = 'form-msg';
        msg.textContent = '';
      }

      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(json.error || 'Error');

        if (msg) {
          msg.className = 'form-msg success';
          msg.textContent = '✅ Dziękujemy! Oddzwonimy jeszcze dziś.';
        }
        form.reset();
      } catch (err) {
        if (msg) {
          msg.className = 'form-msg error';
          msg.textContent = '❌ Nie udało się wysłać. Zadzwoń: 739 980 388';
        }
      }

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });
  });
})();
