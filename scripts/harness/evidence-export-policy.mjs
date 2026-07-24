import fs from "node:fs";
import path from "node:path";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !["ESRCH", "EINVAL"].includes(error.code);
  }
}

export function withFileLock(file, operation) {
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const owner = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });
  try {
    fs.writeFileSync(lockFile, owner, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let existingOwner = null;
    try {
      existingOwner = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    } catch {
      // A malformed lock cannot prove ownership, so fail closed and require explicit cleanup.
    }
    if (processIsAlive(existingOwner?.pid)) throw new Error(`Another process holds the lock: ${lockFile}`);
    throw new Error(`Stale lock requires explicit owner cleanup: ${lockFile}`);
  }
  try {
    return operation();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

function validateEvidenceExport({
  consent,
  command,
  harnessRoot,
  consumerRoot,
  evidenceDir,
  runtimeFiles,
}) {
  if (!consent) {
    throw new Error(
      "Writing evidence outside the harness requires --consent <single-use reference>."
    );
  }
  const ignoreFile = path.join(consumerRoot, ".gitignore");
  const ignored = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8").replace(/\\/g, "/") : "";
  const evidenceRelative = path.relative(consumerRoot, evidenceDir).replace(/\\/g, "/");
  const requiredIgnores = [
    ...runtimeFiles.map((name) => `${evidenceRelative}/${name}`),
    `${evidenceRelative}/*.json.lock`,
    `${evidenceRelative}/*.*.tmp`,
    `${evidenceRelative}/*.*.bak`,
  ];
  const missing = requiredIgnores
    .filter((entry) => !ignored.split(/\r?\n/).includes(entry));
  if (missing.length) {
    throw new Error(`Runtime evidence is not ignored by ${ignoreFile}: ${missing.join(", ")}`);
  }

  return path.join(harnessRoot, ".qa-consent-ledger.json");
}

export function writeBundleAtomic(files, options = {}) {
  const pending = [];
  try {
    for (const { file, content } of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const nonce = `${process.pid}.${Date.now()}`;
      const entry = {
        file,
        temporary: `${file}.${nonce}.tmp`,
        backup: `${file}.${nonce}.bak`,
        published: false,
      };
      pending.push(entry);
      fs.writeFileSync(entry.temporary, content, "utf8");
      if (fs.statSync(entry.temporary).size !== Buffer.byteLength(content)) {
        throw new Error(`Incomplete temporary artifact: ${entry.temporary}`);
      }
      if (options.failDuringStage === pending.length) {
        throw new Error("Injected failure during staging.");
      }
    }
    for (const entry of pending) {
      if (fs.existsSync(entry.file)) fs.renameSync(entry.file, entry.backup);
    }
    for (const entry of pending) {
      fs.renameSync(entry.temporary, entry.file);
      entry.published = true;
      if (options.failAfterPublish === pending.filter((item) => item.published).length) {
        throw new Error("Injected failure after partial publication.");
      }
    }
    for (const { backup } of pending) fs.rmSync(backup, { force: true });
  } catch (error) {
    for (const entry of [...pending].reverse()) {
      if (entry.published) fs.rmSync(entry.file, { force: true });
      if (fs.existsSync(entry.backup)) fs.renameSync(entry.backup, entry.file);
    }
    throw error;
  } finally {
    for (const { temporary, backup } of pending) {
      fs.rmSync(temporary, { force: true });
      fs.rmSync(backup, { force: true });
    }
  }
}

export function publishEvidenceBundle(policy, files) {
  const ledgerFile = validateEvidenceExport(policy);
  return withFileLock(ledgerFile, () => {
    const ledger = fs.existsSync(ledgerFile)
      ? JSON.parse(fs.readFileSync(ledgerFile, "utf8"))
      : { consumed: {} };
    if (ledger.consumed?.[policy.consent]) {
      throw new Error(`Evidence-export consent reference was already consumed: ${policy.consent}`);
    }
    ledger.consumed ??= {};
    ledger.consumed[policy.consent] = {
      command: policy.command,
      evidenceDir: policy.evidenceDir,
      consumedAt: new Date().toISOString(),
    };
    writeBundleAtomic([
      ...files,
      { file: ledgerFile, content: `${JSON.stringify(ledger, null, 2)}\n` },
    ]);
  });
}
