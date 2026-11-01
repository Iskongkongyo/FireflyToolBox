"""Regenerate the offline catalogue from the checked-in Unicode/CLDR data."""
from pathlib import Path
import json,re,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]/'src-tauri/builtin-tools/data'
source=(root/'emoji-test.txt').read_text(encoding='utf-8')
version=re.search(r'^# Version: (.+)$',source,re.M).group(1)
names={};keywords={}
for file in ['zh.xml','zh-derived.xml']:
 for annotation in ET.parse(root/file).iter('annotation'):
  key=annotation.get('cp','').replace('\ufe0f','');value=annotation.text or ''
  (names if annotation.get('type')=='tts' else keywords)[key]=value
groups=[];items=[];group=None
for line in source.splitlines():
 if line.startswith('# group: '):
  group=line[9:];groups.append(group)
 match=re.match(r'^([A-F0-9 ]+)\s*;\s*(fully-qualified|component)\s*#\s*\S+\s+E[\d.]+\s+(.+)$',line)
 if match:
  emoji=''.join(chr(int(cp,16)) for cp in match[1].split());key=emoji.replace('\ufe0f','')
  items.append([emoji,names.get(key,match[3]),(match[3]+' '+keywords.get(key,'')).strip(),groups.index(group)])
requested={e.replace('\ufe0f','') for line in (root/'common-emoji.txt').read_text(encoding='utf-8').splitlines() if not line.startswith('#') for e in line.split()}
items=[item for item in items if item[0].replace('\ufe0f','') in requested]
missing=requested-{item[0].replace('\ufe0f','') for item in items}
if missing:raise ValueError(f'Unknown curated emoji: {missing}')
active=[i for i in range(len(groups)) if any(item[3]==i for item in items)]
for item in items:item[3]=active.index(item[3])
groups=[groups[i] for i in active]
data={'version':version,'curated':True,'groups':groups,'items':items}
(root/'emoji.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print(f'Emoji {version}: {len(items)} entries, {(root/"emoji.json").stat().st_size} bytes')
