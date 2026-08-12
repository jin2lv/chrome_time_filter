(function () {
  const steps = document.querySelectorAll('.step');
  const dots = document.querySelectorAll('.dot');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  const finishBtn = document.getElementById('finish');
  let step = 0;

  function render() {
    steps.forEach((s, i) => (s.hidden = i !== step));
    dots.forEach((d, i) => d.classList.toggle('active', i === step));
    prevBtn.hidden = step === 0;
    nextBtn.hidden = step === steps.length - 1;
    finishBtn.hidden = step !== steps.length - 1;
  }

  nextBtn.addEventListener('click', () => { if (step < steps.length - 1) { step++; render(); } });
  prevBtn.addEventListener('click', () => { if (step > 0) { step--; render(); } });
  finishBtn.addEventListener('click', async () => {
    const strategy = document.querySelector('input[name="strategy"]:checked').value;
    try {
      const prefs = await chrome.storage.local.get('prefs');
      await chrome.storage.local.set({ prefs: { ...(prefs.prefs || {}), defaultStrategy: strategy, onboarded: true } });
    } catch (e) { /* 页面独立运行时静默 */ }
    chrome.tabs?.create({ url: 'https://xueqiu.com/' });
    window.close();
  });

  render();
})();
