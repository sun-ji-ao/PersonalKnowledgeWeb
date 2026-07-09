(function () {
  const progressBar = document.querySelector('[data-reading-progress]');
  const backToTopButton = document.querySelector('[data-back-to-top]');

  function updateProgress() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / scrollHeight) * 100)) : 0;
    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
    if (backToTopButton) {
      backToTopButton.classList.toggle('visible', scrollTop > 420);
    }
  }

  function setupCodeCopy() {
    const codeBlocks = document.querySelectorAll('.markdown-body pre');
    codeBlocks.forEach((block) => {
      if (block.querySelector('.copy-code-button')) {
        return;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code-button';
      button.textContent = '复制';
      button.addEventListener('click', async () => {
        const code = block.querySelector('code')?.innerText ?? '';
        try {
          await navigator.clipboard.writeText(code);
          button.textContent = '已复制';
          window.setTimeout(() => {
            button.textContent = '复制';
          }, 1600);
        } catch {
          button.textContent = '复制失败';
          window.setTimeout(() => {
            button.textContent = '复制';
          }, 1600);
        }
      });
      block.appendChild(button);
    });
  }

  if (backToTopButton) {
    backToTopButton.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  setupCodeCopy();
  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
})();
