import type { ReactNode } from "react";
import { mediaSrc } from "@/lib/api-client";
import {
  parseInline,
  parseMarkdown,
  type MdBlock,
  type MdInline,
} from "@/lib/parse-markdown";

type Props = {
  text: string;
  className?: string;
  testId?: string;
  inline?: boolean;
};

export function FormattedText({ text, className, testId, inline = false }: Props) {
  if (inline) {
    return (
      <span className={className} data-testid={testId}>
        {renderInline(parseInline(text))}
      </span>
    );
  }
  return (
    <div className={["formatted-md", className].filter(Boolean).join(" ")} data-testid={testId}>
      {parseMarkdown(text).map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: MdBlock }) {
  if (block.type === "p") {
    return <p>{renderInline(block.children)}</p>;
  }
  if (block.type === "h") {
    const Tag = (`h${block.level}` as "h1" | "h2" | "h3");
    return <Tag>{renderInline(block.children)}</Tag>;
  }
  if (block.type === "ul") {
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "ol") {
    return (
      <ol>
        {block.items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ol>
    );
  }
  if (block.type === "quote") {
    return <blockquote>{renderInline(block.children)}</blockquote>;
  }
  return (
    <pre>
      <code>{block.value}</code>
    </pre>
  );
}

function renderInline(nodes: MdInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "text") {
      return node.value;
    }
    if (node.type === "code") {
      return <code key={index}>{node.value}</code>;
    }
    if (node.type === "strong") {
      return <strong key={index}>{renderInline(node.children)}</strong>;
    }
    if (node.type === "em") {
      return <em key={index}>{renderInline(node.children)}</em>;
    }
    if (node.type === "link") {
      return (
        <a key={index} href={node.href} target={node.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
          {renderInline(node.children)}
        </a>
      );
    }
    return <img key={index} src={mediaSrc(node.src)} alt={node.alt} />;
  });
}
