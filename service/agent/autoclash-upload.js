const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function validateComponent(value) {
  if (!value || value === "." || value === ".." || value.length > 200 ||
      /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error("Invalid file or folder name. Use a relative folder inside AutoClash.");
  }
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function uploadDestination(rootDir, folder, filename, create = false) {
  validateComponent(filename);
  if (!rootDir || !fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error("The selected AutoClash folder does not exist.");
  }
  const root = fs.realpathSync(rootDir);
  const input = String(folder || "").trim();
  const parts = !input || input === "." ? [] : input.split(/[\\/]/);
  for (const part of parts) validateComponent(part);
  let directory = root;
  for (const part of parts) {
    directory = path.join(directory, part);
    if (create && !fs.existsSync(directory)) fs.mkdirSync(directory);
    if (fs.existsSync(directory)) {
      const real = fs.realpathSync(directory);
      if (!contained(root, real) || !fs.statSync(real).isDirectory()) {
        throw new Error("The destination must stay inside the selected AutoClash folder.");
      }
      directory = real;
    }
  }
  const target = path.join(directory, filename);
  if (!contained(root, target)) throw new Error("Invalid destination.");
  if (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())) {
    throw new Error("The destination is not a regular file.");
  }
  return { root, directory, target, relative: path.relative(root, target) };
}

function attachmentUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) ||
      !/^\/(?:attachments|ephemeral-attachments)\//.test(url.pathname)) {
    throw new Error("Use a file attached directly to the Discord command.");
  }
  return url.href;
}

async function downloadAttachment(attachment, fetchImpl = fetch) {
  if (!Number.isSafeInteger(attachment?.size) || attachment.size < 0 || attachment.size > MAX_UPLOAD_BYTES) {
    throw new Error("Files must be 25 MB or smaller.");
  }
  const response = await fetchImpl(attachmentUrl(attachment.url), {
    redirect: "error", signal: AbortSignal.timeout(60000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Discord attachment download failed (${response.status}). Attach the file again.`);
  }
  if (Number(response.headers.get("content-length")) > MAX_UPLOAD_BYTES) throw new Error("File exceeds 25 MB.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) throw new Error("File exceeds 25 MB.");
    chunks.push(Buffer.from(chunk));
  }
  if (size !== attachment.size) throw new Error("The attachment download was incomplete. Attach the file again.");
  return Buffer.concat(chunks, size);
}

async function saveAttachment({ rootDir, folder = "", attachment, filename, replace = false }, fetchImpl) {
  const name = filename || attachment?.filename;
  const initial = uploadDestination(rootDir, folder, name);
  if (!replace && fs.existsSync(initial.target)) throw new Error("File already exists. Choose replace:true or a different name.");
  const bytes = await downloadAttachment(attachment, fetchImpl);
  const destination = uploadDestination(rootDir, folder, name, true);
  const temporary = path.join(destination.directory, `.upload-${randomUUID()}.part`);
  let backup = "";
  try {
    fs.writeFileSync(temporary, bytes, { flag: "wx" });
    if (replace) {
      if (fs.existsSync(destination.target)) {
        backup = `${destination.target}.backup-${randomUUID()}`;
        fs.copyFileSync(destination.target, backup, fs.constants.COPYFILE_EXCL);
      }
      fs.renameSync(temporary, destination.target);
    } else {
      // A hard link refuses an existing destination, even for simultaneous uploads.
      fs.linkSync(temporary, destination.target);
    }
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("File already exists. Choose replace:true or a different name.");
    throw error;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { ...destination, size: bytes.length, backup: backup ? path.relative(destination.root, backup) : "" };
}

function folderChoices(rootDir, search = "") {
  if (!rootDir || !fs.existsSync(rootDir)) return [];
  const result = [{ name: "AutoClash folder", value: "." }];
  const queue = [{ directory: rootDir, prefix: "", depth: 0 }];
  while (queue.length && result.length < 200) {
    const item = queue.shift();
    for (const entry of fs.readdirSync(item.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const relative = item.prefix ? `${item.prefix}/${entry.name}` : entry.name;
      if (relative.length > 100) continue;
      result.push({ name: relative, value: relative });
      if (item.depth < 1) queue.push({ directory: path.join(item.directory, entry.name), prefix: relative, depth: item.depth + 1 });
      if (result.length >= 200) break;
    }
  }
  return result.filter(choice => choice.name.toLowerCase().includes(String(search).toLowerCase())).slice(0, 25);
}

module.exports = { MAX_UPLOAD_BYTES, uploadDestination, attachmentUrl, downloadAttachment, saveAttachment, folderChoices };
