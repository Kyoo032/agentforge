import type { CSSProperties, ReactNode } from "react";
import { mediaSrc } from "@/lib/api-client";
import { MessageEmbed } from "@/components/message-embed";
import { presentStandaloneLink } from "@/lib/message-embeds";
import { parseInline, parseMarkdown, type MdBlock, type MdInline, type MdTableAlign } from "@/lib/parse-markdown";
import { safeLinkHref } from "@/lib/safe-link";

type MdTable = Extract<MdBlock, { type: "table" }>;

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

function inlinePlainText(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") {
        return node.value;
      }
      if (node.type === "image") {
        return node.alt;
      }
      if (node.type === "link" || node.type === "strong" || node.type === "em") {
        return inlinePlainText(node.children);
      }
      return "";
    })
    .join("");
}

function BlockView({ block }: { block: MdBlock }) {
  if (block.type === "p") {
    const only = block.children.length === 1 ? block.children[0] : undefined;
    if (only?.type === "link") {
      const card = presentStandaloneLink(only.href, inlinePlainText(only.children));
      if (card) {
        return <MessageEmbed kind={card.kind} title={card.title} detail={card.detail} href={card.href} />;
      }
    }
    if (only?.type === "image") {
      return <MessageEmbed kind="image" title={only.alt} src={mediaSrc(only.src)} alt={only.alt} />;
    }
    return <p>{renderInline(block.children)}</p>;
  }
  if (block.type === "h") {
    const Tag = `h${block.level}` as "h1" | "h2" | "h3";
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
  if (block.type === "table") {
    return <TableView block={block} />;
  }
  return (
    <pre>
      <code>{block.value}</code>
    </pre>
  );
}

function TableView({ block }: { block: MdTable }) {
  return (
    <div className="formatted-table">
      <table>
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th key={index} style={cellStyle(block.align[index])}>
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index} style={cellStyle(block.align[index])}>
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cellStyle(align: MdTableAlign | undefined): CSSProperties | undefined {
  return align ? { textAlign: align } : undefined;
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
      const href = safeLinkHref(node.href);
      if (!href) {
        // Anything that is not http(s) is shown as text, never as a clickable target.
        return <span key={index}>{renderInline(node.children)}</span>;
      }
      return (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer">
          {renderInline(node.children)}
        </a>
      );
    }
    return <img key={index} src={mediaSrc(node.src)} alt={node.alt} />;
  });
}
