import { Buffer } from 'node:buffer';
import { basename } from 'node:path';

export function mount() {
  document.querySelector('#run').onclick = () => {
    const filename = basename(document.querySelector('#input').value.trim() || 'empty.txt');
    const bytes = Buffer.from(filename, 'utf8');
    document.querySelector('#output').textContent = `${filename}\nUTF-8 字节数：${bytes.length}\nBase64：${bytes.toString('base64')}`;
  };
}
