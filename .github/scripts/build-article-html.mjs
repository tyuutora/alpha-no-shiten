import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const repoRoot = process.cwd();
const articlesRoot = resolve(repoRoot, "articles");
const distRoot = resolve(repoRoot, "dist");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }
  const closing = markdown.indexOf("\n---\n", 4);
  if (closing === -1) {
    throw new Error("Front matter starts with --- but has no closing ---.");
  }
  return markdown.slice(closing + 5);
}

function inlineMarkdown(text) {
  let value = escapeHtml(text);
  const codeTokens = [];
  value = value.replace(/`([^`]+)`/g, (_match, code) => {
    codeTokens.push(`<code>${code}</code>`);
    return `%%CODE${codeTokens.length - 1}%%`;
  });
  value = value.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    (_match, alt, source) => {
      const imageSource = source.startsWith("./images/")
        ? `../articles/${source.slice(2)}`
        : source;
      return `<img src="${imageSource}" alt="${alt}">`;
    },
  );
  value = value.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    '<a href="$2">$1</a>',
  );
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return value.replace(/%%CODE(\d+)%%/g, (_match, index) => codeTokens[index]);
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const className = language
        ? ` class="language-${escapeHtml(language)}"`
        : "";
      output.push(
        `<pre><code${className}>${escapeHtml(code.join("\n"))}</code></pre>`,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[index + 1])
    ) {
      const cells = (row) =>
        row
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((cell) => inlineMarkdown(cell.trim()));
      const headers = cells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      output.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      output.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      output.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      output.push(`<blockquote><p>${inlineMarkdown(quote.join(" "))}</p></blockquote>`);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !lines[index].startsWith("```") &&
      !(lines[index].includes("|") && index + 1 < lines.length &&
        /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[index + 1]))
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return output.join("\n");
}

async function buildArticle(fileName) {
  const sourcePath = resolve(articlesRoot, fileName);
  const outputName = `${basename(fileName, extname(fileName))}.html`;
  const markdown = stripFrontMatter(await readFile(sourcePath, "utf8"));
  const html = [
    `<!-- Generated from articles/${fileName}. Edit the Markdown source, not this file. -->`,
    markdownToHtml(markdown),
    "",
  ].join("\n");
  await writeFile(resolve(distRoot, outputName), html, "utf8");
  console.log(`Generated dist/${outputName}`);
}

const articles = (await readdir(articlesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name)
  .sort();

await mkdir(distRoot, { recursive: true });
for (const article of articles) {
  await buildArticle(article);
}
