export const unitGroups={
 length:{name:'长度',units:{m:['米',1],km:['千米',1000],cm:['厘米',.01],mm:['毫米',.001],um:['微米',1e-6],inch:['英寸',.0254],foot:['英尺',.3048],yard:['码',.9144],mile:['英里',1609.344]}},
 area:{name:'面积',units:{m2:['平方米',1],km2:['平方千米',1e6],cm2:['平方厘米',.0001],ha:['公顷',10000],mu:['亩',2000/3],sqft:['平方英尺',.09290304],acre:['英亩',4046.8564224]}},
 volume:{name:'体积',units:{m3:['立方米',1],L:['升',.001],mL:['毫升',1e-6],cm3:['立方厘米',1e-6],usgal:['美制加仑',.003785411784],ukgal:['英制加仑',.00454609]}},
 mass:{name:'重量',units:{kg:['千克',1],g:['克',.001],mg:['毫克',1e-6],tonne:['吨',1000],lb:['磅',.45359237],oz:['盎司',.028349523125],jin:['市斤（大陆）',.5],liang:['市两（大陆）',.05]}},
 temperature:{name:'温度',units:{C:['摄氏度',1],F:['华氏度',1],K:['开尔文',1]}},
 speed:{name:'速度',units:{ms:['米/秒',1],kmh:['千米/小时',1/3.6],mph:['英里/小时',.44704],knot:['节',1852/3600],fts:['英尺/秒',.3048]}},
 time:{name:'时间',units:{s:['秒',1],min:['分钟',60],h:['小时',3600],d:['天',86400],week:['周',604800],ms:['毫秒',.001]}},
 data:{name:'数据容量',units:{B:['字节 B',1],bit:['位 bit',.125],KB:['KB（1000 B）',1000],MB:['MB（1000 KB）',1e6],GB:['GB（1000 MB）',1e9],TB:['TB（1000 GB）',1e12],KiB:['KiB（1024 B）',1024],MiB:['MiB（1024 KiB）',1048576],GiB:['GiB（1024 MiB）',1073741824],TiB:['TiB（1024 GiB）',1099511627776]}}
}
export function convertUnit(group,from,to,value){
 const def=unitGroups[group];if(!def?.units[from]||!def.units[to]||String(value).trim()===''||!Number.isFinite(Number(value)))throw new Error('请选择有效单位并输入有限数值。')
 value=Number(value);let result
 if(group==='temperature'){const kelvin=from==='C'?value+273.15:from==='F'?(value-32)*5/9+273.15:value;if(kelvin< -1e-9)throw new Error('温度不能低于绝对零度。');result=to==='K'?kelvin:to==='C'?kelvin-273.15:(kelvin-273.15)*9/5+32}
 else{if(group==='data'&&value<0)throw new Error('数据容量不能为负数。');result=value*def.units[from][1]/def.units[to][1]}
 if(!Number.isFinite(result))throw new Error('数值过大。');return Math.abs(result)<1e-12?0:result
}
