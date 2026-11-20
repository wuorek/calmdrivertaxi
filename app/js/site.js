/* CalmDriver - wspolny JS: przelacznik jezyka PL/EN i menu mobilne */

(function () {
  var root = document.documentElement;

  function getSavedLang() {
    try {
      var saved = localStorage.getItem('cd-lang');
      if (saved === 'pl' || saved === 'en') {
        return saved;
      }
    } catch (e) {
      /* localStorage niedostepny */
    }
    return 'pl';
  }

  function saveLang(lang) {
    try {
      localStorage.setItem('cd-lang', lang);
    } catch (e) {
      /* localStorage niedostepny */
    }
  }

  function applyTexts(lang) {
    var options = document.querySelectorAll('[data-opt-pl]');
    for (var i = 0; i < options.length; i++) {
      options[i].textContent = lang === 'en'
        ? options[i].getAttribute('data-opt-en')
        : options[i].getAttribute('data-opt-pl');
    }
    var fields = document.querySelectorAll('[data-ph-pl]');
    for (var j = 0; j < fields.length; j++) {
      fields[j].setAttribute(
        'placeholder',
        lang === 'en' ? fields[j].getAttribute('data-ph-en') : fields[j].getAttribute('data-ph-pl')
      );
    }
  }

  function setLang(lang, persist) {
    root.setAttribute('data-lang', lang);
    root.setAttribute('lang', lang);
    var buttons = document.querySelectorAll('[data-lang-switch]');
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute('data-lang-switch') === lang;
      buttons[i].classList.toggle('active', active);
      buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    applyTexts(lang);
    if (persist) {
      saveLang(lang);
    }
    document.dispatchEvent(new CustomEvent('cd-lang-change', { detail: lang }));
  }

  /* Przelacznik jezyka jest tylko na stronie glownej; podstrony sa po polsku
     i nie moga dostac lang="en" z zapamietanego wyboru. */
  var bilingual = root.hasAttribute('data-bilingual');

  /* Ustaw jezyk jak najwczesniej, zeby nie bylo migniecia */
  if (bilingual) {
    root.setAttribute('data-lang', getSavedLang());
  }

  document.addEventListener('DOMContentLoaded', function () {
    var buttons = document.querySelectorAll('[data-lang-switch]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        setLang(this.getAttribute('data-lang-switch'), true);
      });
    }
    if (bilingual) {
      setLang(getSavedLang(), false);
    }

    var menuBtn = document.getElementById('menu-btn');
    var menu = document.getElementById('mobile-menu');
    if (menuBtn && menu) {
      menuBtn.addEventListener('click', function () {
        var open = menu.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      var links = menu.querySelectorAll('a');
      for (var j = 0; j < links.length; j++) {
        links[j].addEventListener('click', function () {
          menu.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        });
      }
    }
  });
})();
