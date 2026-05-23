import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

const repoRoot = process.cwd();
const articlesRoot = resolve(repoRoot, "articles");
const baseUrl = required("WP_BASE_URL").replace(/\/+$/, "");
const apiBase = `${baseUrl}/wp-json/wp/v2`;
const auth = Buffer.from(
  `${required("WP_USERNAME")}:${required("WP_APP_PASSWORD")}`,
).toString("base64");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function splitList(value = "") {
  return String(value)
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return { attributes: {}, body: markdown };
  }
  const closing = markdown.indexOf("\n---\n", 4);
  if (closing === -1) {
    throw new Error("Front matter starts with --- but has no closing ---.");
  }
  const attributes = {};
  for (const line of markdown.slice(4, closing).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      attributes[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { attributes, body: markdown.slice(closing + 5) };
}

function slugifyFile(filePath) {
  return basename(filePath, extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assertArticlePath(filePath) {
  const absolute = resolve(repoRoot, filePath);
  const fromArticles = relative(articlesRoot, absolute);
  if (fromArticles.startsWith("..") || fromArticles.includes(`..${sep}`)) {
    throw new Error(`Article path must be inside articles/: ${filePath}`);
  }
  return absolute;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    '<img src="$2" alt="$1">',
  );
  value = value.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
    '<a href="$2">$1</a>',
  );
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  value = value.replace(/%%CODE(\d+)%%/g, (_match, index) => codeTokens[index]);
  return value;
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
      index += 1;
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
      const row = (input) =>
        input
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((cell) => inlineMarkdown(cell.trim()));
      const headers = row(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(row(lines[index]));
        index += 1;
      }
      output.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
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
      !lines[index].startsWith("```")
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return output.join("\n");
}

async function wpRequest(endpoint, options = {}) {
  const response = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`WordPress API ${response.status} ${endpoint}: ${message}`);
  }
  return response.status === 204 ? null : response.json();
}

async function categoryIds(attributes) {
  const explicitIds = splitList(
    attributes.category_ids || process.env.WP_DEFAULT_CATEGORY_IDS,
  ).map((id) => Number(id));
  if (explicitIds.length) {
    if (explicitIds.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new Error("category_ids / WP_DEFAULT_CATEGORY_IDS must contain numeric WordPress category IDs.");
    }
    return explicitIds;
  }
  const slugs = splitList(
    attributes.categories || process.env.WP_DEFAULT_CATEGORY_SLUGS,
  );
  if (!slugs.length) {
    throw new Error(
      "No category configured. Add category_ids to article front matter or set WP_DEFAULT_CATEGORY_IDS.",
    );
  }
  const ids = [];
  for (const slug of slugs) {
    const items = await wpRequest(`/categories?slug=${encodeURIComponent(slug)}&per_page=1`);
    if (!items.length) {
      throw new Error(`WordPress category slug not found: ${slug}`);
    }
    ids.push(items[0].id);
  }
  return ids;
}

async function existingPost(slug) {
  for (const status of ["draft", "pending", "private", "future", "publish"]) {
    const items = await wpRequest(
      `/posts?context=edit&slug=${encodeURIComponent(slug)}&status=${status}&per_page=1`,
    );
    if (items.length) {
      if (status === "publish") {
        throw new Error(
          `A published WordPress post already uses slug "${slug}". Refusing to convert it to a draft.`,
        );
      }
      return items[0];
    }
  }
  return null;
}

function mimeType(filePath) {
  const extension = extname(filePath).toLowerCase();
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    }[extension] || "application/octet-stream"
  );
}

async function localImage(articlePath, imageReference) {
  if (!imageReference || /^(https?:)?\/\//.test(imageReference)) {
    return null;
  }
  const filePath = resolve(dirname(articlePath), decodeURI(imageReference));
  const fromRepo = relative(repoRoot, filePath);
  if (fromRepo.startsWith("..") || fromRepo.includes(`..${sep}`)) {
    throw new Error(`Featured image must be stored inside the repository: ${imageReference}`);
  }
  try {
    await access(filePath);
    return { absolute: filePath, repositoryPath: fromRepo.split(sep).join("/") };
  } catch {
    console.warn(`Featured image is not present yet: ${fromRepo}`);
    return null;
  }
}

async function uploadMedia(image, title, altText) {
  const bytes = await readFile(image.absolute);
  const created = await wpRequest("/media", {
    method: "POST",
    headers: {
      "Content-Disposition": `attachment; filename="${basename(image.absolute)}"`,
      "Content-Type": mimeType(image.absolute),
    },
    body: bytes,
  });
  await wpRequest(`/media/${created.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, alt_text: altText }),
  });
  return created.id;
}

function gitFiles(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function changedPaths() {
  const requested = process.env.ARTICLE_PATH?.trim();
  if (requested) {
    return new Set([requested]);
  }
  const before = process.env.BEFORE_SHA || "";
  const after = process.env.GITHUB_SHA || "HEAD";
  if (!before || /^0+$/.test(before)) {
    return new Set(gitFiles(["ls-tree", "-r", "--name-only", after, "--", "articles"]));
  }
  return new Set(gitFiles(["diff", "--name-only", `${before}..${after}`, "--", "articles"]));
}

async function affectedArticles(paths) {
  const articles = new Set(
    [...paths].filter((path) => path.startsWith("articles/") && path.endsWith(".md")),
  );
  const changedImages = [...paths].filter((path) =>
    /\.(png|jpe?g|gif|webp)$/i.test(path),
  );
  if (!changedImages.length) {
    return [...articles];
  }
  for (const candidate of gitFiles(["ls-files", "--", "articles"])) {
    if (!candidate.endsWith(".md")) {
      continue;
    }
    const source = await readFile(resolve(repoRoot, candidate), "utf8");
    for (const image of changedImages) {
      const relativeReference = relative(dirname(candidate), image).split(sep).join("/");
      if (source.includes(relativeReference) || source.includes(image)) {
        articles.add(candidate);
      }
    }
  }
  return [...articles];
}

async function publishDraft(repositoryPath, modifiedPaths) {
  const articlePath = assertArticlePath(repositoryPath);
  const source = await readFile(articlePath, "utf8");
  const { attributes, body } = parseFrontMatter(source);
  const titleLine = body.match(/^#\s+(.+)$/m);
  if (!titleLine) {
    throw new Error(`Article must have an H1 title: ${repositoryPath}`);
  }
  const title = titleLine[1].replace(/[*_`]/g, "").trim();
  const slug = attributes.slug || slugifyFile(repositoryPath);
  const imageMatch = body.match(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
  const imageReference = attributes.featured_image || imageMatch?.[2];
  const imageAlt = attributes.featured_image_alt || imageMatch?.[1] || title;
  const image = await localImage(articlePath, imageReference);
  const post = await existingPost(slug);
  const categories = await categoryIds(attributes);

  let featuredMedia = post?.featured_media || 0;
  const imageWasModified = image && modifiedPaths.has(image.repositoryPath);
  if (image && (!post || !featuredMedia || imageWasModified)) {
    featuredMedia = await uploadMedia(image, title, imageAlt);
  }

  let articleBody = body.replace(titleLine[0], "").trim();
  if (imageMatch && attributes.keep_featured_image !== "true") {
    articleBody = articleBody.replace(imageMatch[0], "").trim();
  }
  const payload = {
    title,
    slug,
    content: markdownToHtml(articleBody),
    status: "draft",
    categories,
    ...(featuredMedia ? { featured_media: featuredMedia } : {}),
  };
  const endpoint = post ? `/posts/${post.id}` : "/posts";
  const result = await wpRequest(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log(`${post ? "Updated" : "Created"} WordPress draft #${result.id}: ${title}`);
}

const modifiedPaths = await changedPaths();
const articles = await affectedArticles(modifiedPaths);
if (!articles.length) {
  console.log("No affected article Markdown files found.");
  process.exit(0);
}
for (const article of articles) {
  await publishDraft(article, modifiedPaths);
}
