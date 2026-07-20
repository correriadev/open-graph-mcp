import ReactMarkdown from "react-markdown"
import rehypeSanitize from "rehype-sanitize"

export function SafeMarkdown({ children }: { children: string }) {
  const lines = children.split("\n")
  const separator = lines.findIndex((line) => /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(line))
  if (separator < 1 || separator >= lines.length - 1) return <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{children}</ReactMarkdown>
  const cells = (line: string) => line.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim())
  const header = cells(lines[separator - 1]!)
  const rows: string[][] = []
  let end = separator + 1
  while (end < lines.length && lines[end]!.includes("|")) rows.push(cells(lines[end++]!))
  const before = lines.slice(0, separator - 1).join("\n")
  const after = lines.slice(end).join("\n")
  return <>
    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{before}</ReactMarkdown>
    <table><thead><tr>{header.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>
    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{after}</ReactMarkdown>
  </>
}
