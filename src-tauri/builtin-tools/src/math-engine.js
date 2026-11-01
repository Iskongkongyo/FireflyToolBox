export function calculate(expression,{degrees=true,ans=0}={}){
 if(typeof expression!=='string'||expression.length>512)throw new Error('表达式最多 512 字符。')
 const tokens=[];let at=0
 while(at<expression.length){if(/\s/.test(expression[at])){at++;continue}const part=expression.slice(at),match=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[A-Za-z]+|^[+\-*/^%(),]/.exec(part);if(!match)throw new Error('不支持的字符：'+expression[at]);tokens.push(match[0]);at+=match[0].length}
 let index=0,depth=0;const peek=()=>tokens[index],take=()=>tokens[index++],finite=n=>{if(!Number.isFinite(n))throw new Error('结果无定义或超出数值范围。');return n},trig=n=>degrees?n*Math.PI/180:n
 const funcs={sqrt:Math.sqrt,abs:Math.abs,ln:Math.log,log:Math.log10,exp:Math.exp,floor:Math.floor,ceil:Math.ceil,round:Math.round,sin:n=>Math.sin(trig(n)),cos:n=>Math.cos(trig(n)),tan:n=>Math.tan(trig(n)),asin:n=>Math.asin(n)*(degrees?180/Math.PI:1),acos:n=>Math.acos(n)*(degrees?180/Math.PI:1),atan:n=>Math.atan(n)*(degrees?180/Math.PI:1),min:Math.min,max:Math.max,pow:Math.pow,mod:(a,b)=>a%b}
 function primary(){if(++depth>32)throw new Error('表达式嵌套过深。');let value;const token=take();if(token==='('){value=add();if(take()!==')')throw new Error('括号不匹配。')}else if(token&&/^[\d.]/.test(token))value=Number(token);else if(token&&/^[A-Za-z]+$/.test(token)){const name=token.toLowerCase();if(['pi','e','ans'].includes(name))value=name==='pi'?Math.PI:name==='e'?Math.E:Number(ans);else{if(!funcs[name]||take()!=='(')throw new Error('未知函数或常量：'+name);const args=[add()];while(peek()===','){take();args.push(add());if(args.length>16)throw new Error('参数过多。')}if(take()!==')')throw new Error('函数括号不匹配。');if(!['min','max'].includes(name)&&args.length!==(['pow','mod'].includes(name)?2:1))throw new Error('函数参数个数无效。');value=funcs[name](...args)}}else throw new Error('表达式不完整。');depth--;while(peek()==='%'){take();value/=100}return finite(value)}
 const power=()=>{const value=primary();return peek()==='^'?(take(),finite(value**unary())):value}
 const unary=()=>peek()==='+'?(take(),unary()):peek()==='-'?(take(),-unary()):power()
 const multiply=()=>{let value=unary();while(['*','/'].includes(peek())){const op=take(),right=unary();if(op==='/'&&right===0)throw new Error('不能除以零。');value=finite(op==='*'?value*right:value/right)}return value}
 function add(){let value=multiply();while(['+','-'].includes(peek())){const op=take(),right=multiply();value=finite(op==='+'?value+right:value-right)}return value}
 if(!tokens.length)throw new Error('请输入表达式。');const result=add();if(index!==tokens.length)throw new Error('运算符缺失或括号不匹配。');return finite(result)
}
