export function mount() {
  document.querySelector('#run').onclick = async () => {
    const count = Number(localStorage.getItem('runs') ?? '0') + 1;
    localStorage.setItem('runs', String(count));
    await Promise.resolve();
    document.querySelector('#output').textContent = `第 ${count} 次：${document.querySelector('#input').value}`;
  };
}
