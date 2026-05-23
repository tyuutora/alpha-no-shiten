import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const repoRoot = process.cwd();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const baseUrl = required("WP_BASE_URL").replace(/\/+$/, "");
const username = required("WP_USERNAME");
const appPassword = required("WP_APP_PASSWORD");
const authorization = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;

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
  value = value.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
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
  let skippedTitle = false;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (level === 1 && !skippedTitle) {
        skippedTitle = true;
        index += 1;
        continue;
      }
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^!\[([^\]]*)\]\([^)]+\)\s*$/.test(line)) {
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
      output.push(`<table><thead><tr>${headers.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
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
      !/^!\[([^\]]*)\]\([^)]+\)\s*$/.test(lines[index]) &&
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

function markdownTitle(markdown, filePath) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return title?.replace(/[*_`]/g, "") || basename(filePath, extname(filePath));
}

function slugFromPath(filePath) {
  return basename(filePath, extname(filePath));
}

async function wordpressRequest(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    console.error("HTTP status: NETWORK_ERROR");
    console.error(`endpoint: ${endpoint}`);
    console.error(`response body: ${error.message}`);
    throw new Error(`WordPress request failed: NETWORK_ERROR ${endpoint}`);
  }
  const body = await response.text();
  if (!response.ok) {
    console.error(`HTTP status: ${response.status}`);
    console.error(`endpoint: ${endpoint}`);
    console.error(`response body: ${body}`);
    throw new Error(`WordPress request failed: ${response.status} ${endpoint}`);
  }
  if (!body) {
    return null;
  }
  return JSON.parse(body);
}

async function publishDraft(filePath) {
  if (!filePath.startsWith("articles/") || !filePath.endsWith(".md")) {
    throw new Error(`Only articles/**/*.md is supported: ${filePath}`);
  }

  const markdown = stripFrontMatter(await readFile(resolve(repoRoot, filePath), "utf8"));
  const title = markdownTitle(markdown, filePath);
  const slug = slugFromPath(filePath);
  const content = markdownToHtml(markdown);
  const existing = await wordpressRequest(
    `/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&status=any&per_page=1&_fields=id,slug,status`,
  );

  const payload = JSON.stringify({
    title,
    slug,
    status: "draft",
    content,
  });

  if (Array.isArray(existing) && existing.length > 0) {
    await wordpressRequest(`/wp-json/wp/v2/posts/${existing[0].id}`, {
      method: "POST",
      body: payload,
    });
    console.log(`Updated WordPress draft: ${slug}`);
    return;
  }

  await wordpressRequest("/wp-json/wp/v2/posts", {
    method: "POST",
    body: payload,
  });
  console.log(`Created WordPress draft: ${slug}`);
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    throw new Error("No Markdown files were provided.");
  }

  await wordpressRequest("/wp-json/wp/v2/users/me");
  for (const file of files) {
    await publishDraft(file);
  }
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
