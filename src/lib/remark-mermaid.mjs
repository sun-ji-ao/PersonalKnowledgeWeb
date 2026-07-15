import { visit } from 'unist-util-visit';

/**
 * 将 ```mermaid 围栏代码块转换为 <div class="mermaid">，供客户端 Mermaid 渲染。
 */
export function remarkMermaid() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || node.lang !== 'mermaid') {
        return;
      }
      parent.children[index] = {
        type: 'html',
        value: `<div class="mermaid">\n${node.value}\n</div>`
      };
    });
  };
}
