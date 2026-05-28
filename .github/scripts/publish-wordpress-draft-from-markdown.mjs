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

function cleanFrontMatterValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontMatter(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { data: {}, body: normalized };
  }
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing === -1) {
    throw new Error("frontmatter: starts with --- but has no closing ---.");
  }

  const data = {};
  let arrayKey = null;
  for (const line of normalized.slice(4, closing).split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const item = line.match(/^\s*-\s+(.+)\s*$/);
    if (item && arrayKey) {
      data[arrayKey].push(cleanFrontMatterValue(item[1]));
      continue;
    }
    const field = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) {
      throw new Error(`frontmatter: unsupported line "${line}"`);
    }
    const [, key, rawValue] = field;
    const value = rawValue.trim();
    if (!value) {
      data[key] = [];
      arrayKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map(cleanFrontMatterValue)
        .filter(Boolean);
      arrayKey = null;
    } else {
      data[key] = cleanFrontMatterValue(value);
      arrayKey = null;
    }
  }
  return { data, body: normalized.slice(closing + 5) };
}

function frontMatterString(data, ...names) {
  for (const name of names) {
    if (typeof data[name] === "string" && data[name].trim()) {
      return data[name].trim();
    }
  }
  return undefined;
}

function frontMatterList(data, name) {
  const value = data[name];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
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

function plainMarkdown(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function autoFocusKeyword(title, tagNames, categoryName) {
  const titleKeyword = title
    .replace(/^【[^】]+】/, "")
    .split(/[｜|:：]/)[0]
    .replace(/[「」『』]/g, "")
    .replace(/レビュー.*$/, "レビュー")
    .replace(/完全ガイド.*$/, "完全ガイド")
    .replace(/おすすめ\d*本?.*$/, "おすすめ")
    .trim();
  if (titleKeyword.length >= 4) {
    return titleKeyword.slice(0, 40);
  }

  const genericTags = new Set(["SONY", "撮影テクニック", "カメラ初心者", categoryName]);
  const tagKeyword = tagNames.find((tag) => tag && !genericTags.has(tag));
  return tagKeyword || categoryName || title.slice(0, 40);
}

function firstUsefulParagraph(markdown) {
  for (const block of markdown.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (
      !trimmed ||
      /^#{1,6}\s+/.test(trimmed) ||
      /^[-*]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      trimmed.includes("|---")
    ) {
      continue;
    }
    const plain = plainMarkdown(trimmed);
    if (plain.length >= 30) {
      return plain;
    }
  }
  return "";
}

function autoMetaDescription(markdown, title) {
  const paragraph = firstUsefulParagraph(markdown);
  const seed = paragraph || `${title}について、初心者にも分かりやすくポイントと注意点を解説します。`;
  const description = seed.replace(/\s+/g, " ").trim();
  return description.length > 120 ? `${description.slice(0, 119)}…` : description;
}

async function wordpressRequest(endpoint, options = {}, item = "WordPress request") {
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
    console.error(`item: ${item}`);
    console.error("HTTP status: NETWORK_ERROR");
    console.error(`endpoint: ${endpoint}`);
    console.error(`response body: ${error.message}`);
    throw new Error(`WordPress request failed: NETWORK_ERROR ${endpoint}`);
  }
  const body = await response.text();
  if (!response.ok) {
    console.error(`item: ${item}`);
    console.error(`HTTP status: ${response.status}`);
    console.error(`endpoint: ${endpoint}`);
    console.error(`response body: ${body}`);
    throw new Error(`WordPress request failed: ${response.status} ${endpoint}`);
  }
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    console.error(`item: ${item}`);
    console.error(`HTTP status: ${response.status}`);
    console.error(`endpoint: ${endpoint}`);
    console.error(`response body: ${body}`);
    throw new Error(`WordPress returned invalid JSON for ${item}: ${error.message}`);
  }
}

function exactTermMatch(terms, name) {
  const normalized = name.trim().toLocaleLowerCase();
  return terms.find((term) => term.name?.trim().toLocaleLowerCase() === normalized);
}

async function resolveCategoryId(name) {
  const endpoint = `/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}&per_page=100&_fields=id,name`;
  const categories = await wordpressRequest(endpoint, {}, `category "${name}" search`);
  const category = exactTermMatch(Array.isArray(categories) ? categories : [], name);
  if (!category) {
    console.error(`item: category "${name}" resolution`);
    throw new Error(`WordPress category does not exist: ${name}`);
  }
  return category.id;
}

async function resolveTagId(name) {
  const searchEndpoint = `/wp-json/wp/v2/tags?search=${encodeURIComponent(name)}&per_page=100&_fields=id,name`;
  const tags = await wordpressRequest(searchEndpoint, {}, `tag "${name}" search`);
  const existing = exactTermMatch(Array.isArray(tags) ? tags : [], name);
  if (existing) {
    return existing.id;
  }
  const created = await wordpressRequest(
    "/wp-json/wp/v2/tags",
    { method: "POST", body: JSON.stringify({ name }) },
    `tag "${name}" creation`,
  );
  if (!created?.id) {
    console.error(`item: tag "${name}" creation`);
    throw new Error(`WordPress did not return an ID for created tag: ${name}`);
  }
  return created.id;
}

function verifyRankMathMeta(post, expected, slug) {
  if (Object.keys(expected).length === 0) {
    return;
  }
  if (!post?.meta) {
    console.error(`item: Rank Math meta verification for post "${slug}"`);
    throw new Error(
      "WordPress response does not expose post meta. Install and activate the REST meta registration plugin.",
    );
  }
  for (const [key, value] of Object.entries(expected)) {
    if (post.meta[key] !== value) {
      console.error(`item: Rank Math meta "${key}" verification for post "${slug}"`);
      throw new Error(`WordPress did not store expected Rank Math meta: ${key}`);
    }
  }
}

async function publishDraft(filePath) {
  if (!filePath.startsWith("articles/") || !filePath.endsWith(".md")) {
    throw new Error(`Only articles/**/*.md is supported: ${filePath}`);
  }

  let parsed;
  try {
    parsed = parseFrontMatter(await readFile(resolve(repoRoot, filePath), "utf8"));
  } catch (error) {
    console.error(`item: frontmatter in ${filePath}`);
    throw error;
  }
  const { data, body: markdown } = parsed;
  const title = frontMatterString(data, "title") || markdownTitle(markdown, filePath);
  const slug = frontMatterString(data, "slug") || slugFromPath(filePath);
  const seoTitle = frontMatterString(data, "seo_title");
  const categoryName = frontMatterString(data, "category");
  const tagNames = frontMatterList(data, "tags");
  const explicitFocusKeyword = frontMatterString(data, "focus_keyword", "focus_keyphrase");
  const explicitMetaDescription = frontMatterString(data, "meta_description", "description");
  const focusKeyword = explicitFocusKeyword || autoFocusKeyword(title, tagNames, categoryName);
  const metaDescription = explicitMetaDescription || autoMetaDescription(markdown, title);
  const content = markdownToHtml(markdown);
  const categoryId = categoryName ? await resolveCategoryId(categoryName) : undefined;
  const tagIds = [];
  for (const tagName of tagNames) {
    tagIds.push(await resolveTagId(tagName));
  }
  const existing = await wordpressRequest(
    `/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&status=any&per_page=1&_fields=id,slug,status`,
    {},
    `post "${slug}" lookup`,
  );

  const post = {
    title,
    slug,
    status: "draft",
    content,
  };
  if (categoryId !== undefined) {
    post.categories = [categoryId];
  }
  if (tagIds.length > 0) {
    post.tags = tagIds;
  }
  const meta = {};
  if (seoTitle) {
    meta.rank_math_title = seoTitle;
  }
  if (metaDescription) {
    meta.rank_math_description = metaDescription;
  }
  if (focusKeyword) {
    meta.rank_math_focus_keyword = focusKeyword;
  }
  if (Object.keys(meta).length > 0) {
    post.meta = meta;
  }
  if (!explicitFocusKeyword && focusKeyword) {
    console.log(`Auto focus keyword for ${slug}: ${focusKeyword}`);
  }
  if (!explicitMetaDescription && metaDescription) {
    console.log(`Auto meta description for ${slug}: ${metaDescription}`);
  }
  const payload = JSON.stringify(post);

  if (Array.isArray(existing) && existing.length > 0) {
    const result = await wordpressRequest(`/wp-json/wp/v2/posts/${existing[0].id}`, {
      method: "POST",
      body: payload,
    }, `post "${slug}" update`);
    verifyRankMathMeta(result, meta, slug);
    console.log(`Updated WordPress draft: ${slug}`);
    return;
  }

  const result = await wordpressRequest("/wp-json/wp/v2/posts", {
    method: "POST",
    body: payload,
  }, `post "${slug}" creation`);
  verifyRankMathMeta(result, meta, slug);
  console.log(`Created WordPress draft: ${slug}`);
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    throw new Error("No Markdown files were provided.");
  }

  await wordpressRequest("/wp-json/wp/v2/users/me", {}, "authentication check");
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
