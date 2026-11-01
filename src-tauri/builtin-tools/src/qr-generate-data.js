import QRCode from 'qrcode/lib/core/qrcode.js'
const single=value=>String(value??'').trim()
const wifi=value=>String(value??'').replace(/[\\;,:\"]/g,'\\$&')
const vcard=value=>String(value||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/[,;]/g,'\\$&')
function email(value){const mail=single(value);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail))throw new Error('请输入有效邮箱地址。');return mail}
function phone(value){const number=single(value).replace(/[ ()-]/g,'');if(!/^\+?\d{3,20}$/.test(number))throw new Error('请输入有效电话号码，可带 + 号和国家区号。');return number}
export function qrPayload(data){
 let result
 switch(data.type){
  case 'text':result=String(data.text||'');break
  case 'url':{if(/^[a-z][a-z\d+.-]*:/i.test(single(data.url))&&!/^https?:\/\//i.test(single(data.url)))throw new Error('仅支持 HTTP / HTTPS 网址。');let url;try{url=new URL(/^https?:\/\//i.test(single(data.url))?single(data.url):'https://'+single(data.url))}catch{throw new Error('请输入有效的 HTTP / HTTPS 网址。')}if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)throw new Error('请输入不含账号信息的 HTTP / HTTPS 网址。');result=url.href;break}
  case 'wifi':if(!String(data.ssid||''))throw new Error('请填写 Wi-Fi 名称。');if(!['WPA','WEP','nopass'].includes(data.security))throw new Error('Wi-Fi 加密方式无效。');if(data.security!=='nopass'&&!data.password)throw new Error('请填写 Wi-Fi 密码，或选择无密码网络。');result=`WIFI:T:${data.security};S:${wifi(data.ssid)};${data.security==='nopass'?'':`P:${wifi(data.password)};`}H:${data.hidden?'true':'false'};;`;break
  case 'contact':if(!single(data.name))throw new Error('请填写联系人姓名。');result=['BEGIN:VCARD','VERSION:3.0',`N:${vcard(data.name)};;;;`,`FN:${vcard(data.name)}`,...[['ORG',data.company],['TEL',data.phone],['EMAIL',data.email],['URL',data.url],['NOTE',data.note]].filter(([,v])=>single(v)).map(([k,v])=>`${k}:${vcard(v)}`),'END:VCARD'].join('\r\n');break
  case 'email':result=`mailto:${email(data.email)}?subject=${encodeURIComponent(data.subject||'')}&body=${encodeURIComponent(data.body||'')}`;break
  case 'phone':result='tel:'+phone(data.phone);break
  case 'sms':result='SMSTO:'+phone(data.phone)+':'+String(data.body||'');break
  case 'geo':{const lat=Number(data.latitude),lon=Number(data.longitude);if(!single(data.latitude)||!single(data.longitude)||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('请输入有效经纬度：纬度 -90～90，经度 -180～180。');result=`geo:${lat},${lon}`;break}
  default:throw new Error('二维码内容类型无效。')
 }
 if(!result)throw new Error('请填写二维码内容。');if(new TextEncoder().encode(result).length>8000)throw new Error('内容超过 8000 UTF-8 字节，请缩短后重试。');return result
}
function luminance(color){const values=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722}
export function qrOptions(data){
 const size=Number(data.size),margin=Number(data.margin),version=Number(data.version),level=data.level,dark=data.dark,light=data.light
 if(!Number.isInteger(size)||size<128||size>2048)throw new Error('图片尺寸需为 128～2048 px 的整数。');if(!Number.isInteger(margin)||margin<4||margin>16)throw new Error('留白需为 4～16 个二维码单元。');if(!Number.isInteger(version)||version<0||version>40||!['L','M','Q','H'].includes(level))throw new Error('版本或纠错等级无效。');if(!/^#[0-9a-f]{6}$/i.test(dark)||!/^#[0-9a-f]{6}$/i.test(light))throw new Error('请选择有效颜色。');const foreground=luminance(dark),background=luminance(data.transparent?'#ffffff':light);if(foreground>=background||(background+.05)/(foreground+.05)<4.5)throw new Error('前景色需比背景色深，并有足够对比度；请换用较深的前景色。')
 return{size,margin,version:version||undefined,level,dark,light,transparent:!!data.transparent}
}
export function qrMatrix(payload,options){let qr;try{qr=QRCode.create(payload,{errorCorrectionLevel:options.level,version:options.version})}catch{throw new Error(options.version?'所选版本容量不足，请选择自动版本或缩短内容。':'内容超出二维码容量，请缩短内容。')}return{cells:Array.from(qr.modules.data),size:qr.modules.size,version:qr.version,mask:qr.maskPattern}}
export function qrGeometry(matrix,options){const scale=Math.floor(options.size/(matrix.size+2*options.margin));if(scale<2)throw new Error(`二维码较密，请把图片尺寸增大到至少 ${(matrix.size+2*options.margin)*2} px。`);return{scale,offset:Math.floor((options.size-matrix.size*scale)/2)}}
export function qrSVG(matrix,options,logo=''){if(logo&&!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo))throw new Error('图标数据无效。');const side=matrix.size+options.margin*2;let path='';for(let y=0;y<matrix.size;y++)for(let x=0;x<matrix.size;x++)if(matrix.cells[y*matrix.size+x])path+=`M${x+options.margin} ${y+options.margin}h1v1h-1z`;const overlay=logo?(()=>{const width=matrix.size*.18,left=(side-width)/2;return`<rect x="${left}" y="${left}" width="${width}" height="${width}" fill="#fff"/><image x="${left+width*.08}" y="${left+width*.08}" width="${width*.84}" height="${width*.84}" href="${logo}"/>`})():'';return`<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">${options.transparent?'':`<rect width="${side}" height="${side}" fill="${options.light}"/>`}<path fill="${options.dark}" d="${path}"/>${overlay}</svg>`}
