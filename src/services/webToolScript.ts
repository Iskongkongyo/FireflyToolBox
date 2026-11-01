import { parse, type AnyNode, type BlockStatement } from 'acorn'
import { full } from 'acorn-walk'
import MagicString from 'magic-string'

export function protectWebToolScript(source: string, hook: string, scriptName: string): string {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const output = new MagicString(source)
  const guard = `__firefly_${hook}`
  const check = `;${guard}();`
  function protectBlock(body: BlockStatement) {
    let position = body.start + 1
    for (const statement of body.body) {
      if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'Literal'
        || typeof statement.expression.value !== 'string') break
      position = statement.end
    }
    output.appendLeft(position, check)
  }
  full(tree, (value) => {
    const node = value as AnyNode
    if (['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(node.type)) {
      const body = (node as Extract<AnyNode, { type: 'WhileStatement' }>).body
      if (body.type === 'BlockStatement') protectBlock(body)
      else {
        output.prependLeft(body.start, `{${check}`)
        output.appendRight(body.end, '}')
      }
    } else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.body.type === 'BlockStatement') protectBlock(node.body)
      else {
        output.prependLeft(node.body.start, `(${guard}(),`)
        output.appendRight(node.body.end, ')')
      }
    }
  })
  const firstLine = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0
  output.prependLeft(firstLine, `const ${guard}=globalThis[${JSON.stringify(hook)}];${check}\n`)
  const map = output.generateMap({ source: scriptName, includeContent: true, hires: false })
  return `${output.toString()}\n//# sourceMappingURL=${map.toUrl()}`
}
