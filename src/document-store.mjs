import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sqlClients = new Map();
const schemaReady = new Map();

export function createDocumentStore({ documentKey, fallbackPath, initialValue, databaseUrl = process.env.DATABASE_URL || "" }) {
  if (!documentKey) {
    throw new Error("A documentKey is required for the document store.");
  }

  const preferredPath = path.isAbsolute(fallbackPath) ? fallbackPath : path.resolve(process.cwd(), fallbackPath);
  const resolvedPath = resolveWritablePath(preferredPath, initialValue);
  const normalizedInitialValue = cloneValue(initialValue);
  const useDatabase = Boolean(String(databaseUrl || "").trim());

  return {
    documentKey,
    statePath: resolvedPath,
    storageMode: useDatabase ? "neon-postgres" : resolvedPath === preferredPath ? "project-file" : "temp-file",
    async read() {
      if (!useDatabase) {
        return readStateFile(resolvedPath, normalizedInitialValue);
      }

      try {
        const databaseValue = await readDatabaseDocument({ databaseUrl, documentKey, initialValue: normalizedInitialValue });

        if (!isInitialLike(databaseValue, normalizedInitialValue)) {
          return databaseValue;
        }

        const fileValue = readStateFile(resolvedPath, normalizedInitialValue);

        if (!isInitialLike(fileValue, normalizedInitialValue)) {
          try {
            await writeDatabaseDocument({
              databaseUrl,
              documentKey,
              value: fileValue,
              initialValue: normalizedInitialValue
            });
          } catch {
          }

          return fileValue;
        }

        return databaseValue;
      } catch {
        return readStateFile(resolvedPath, normalizedInitialValue);
      }
    },
    async write(nextValue) {
      if (!useDatabase) {
        writeStateFile(resolvedPath, nextValue, normalizedInitialValue);
        return normalizeValue(nextValue, normalizedInitialValue);
      }

      try {
        await writeDatabaseDocument({
          databaseUrl,
          documentKey,
          value: nextValue,
          initialValue: normalizedInitialValue
        });
        writeStateFile(resolvedPath, nextValue, normalizedInitialValue);
      } catch {
        writeStateFile(resolvedPath, nextValue, normalizedInitialValue);
      }

      return normalizeValue(nextValue, normalizedInitialValue);
    }
  };
}

async function readDatabaseDocument({ databaseUrl, documentKey, initialValue }) {
  await ensureDatabaseSchema(databaseUrl);
  const sql = await getSqlClient(databaseUrl);
  const rows = await sql`SELECT payload FROM app_documents WHERE id = ${documentKey} LIMIT 1`;
  return normalizeValue(rows[0]?.payload, initialValue);
}

async function writeDatabaseDocument({ databaseUrl, documentKey, value, initialValue }) {
  await ensureDatabaseSchema(databaseUrl);
  const sql = await getSqlClient(databaseUrl);
  const payload = JSON.stringify(normalizeValue(value, initialValue));

  await sql`
    INSERT INTO app_documents (id, payload, updated_at)
    VALUES (${documentKey}, CAST(${payload} AS jsonb), NOW())
    ON CONFLICT (id)
    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
  `;
}

async function ensureDatabaseSchema(databaseUrl) {
  const cacheKey = String(databaseUrl || "").trim();

  if (!cacheKey) {
    return;
  }

  if (!schemaReady.has(cacheKey)) {
    schemaReady.set(
      cacheKey,
      (async () => {
        const sql = await getSqlClient(cacheKey);
        await sql`
          CREATE TABLE IF NOT EXISTS app_documents (
            id TEXT PRIMARY KEY,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;
      })().catch((error) => {
        schemaReady.delete(cacheKey);
        throw error;
      })
    );
  }

  return schemaReady.get(cacheKey);
}

async function getSqlClient(databaseUrl) {
  const cacheKey = String(databaseUrl || "").trim();

  if (!cacheKey) {
    throw new Error("DATABASE_URL is required to initialize the database-backed store.");
  }

  if (!sqlClients.has(cacheKey)) {
    const { neon } = await import("@neondatabase/serverless");
    sqlClients.set(cacheKey, neon(cacheKey));
  }

  return sqlClients.get(cacheKey);
}

function ensureStateFile(filePath, initialValue) {
  if (fs.existsSync(filePath)) {
    return true;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalizeValue(initialValue, initialValue), null, 2)}\n`, "utf8");
  return true;
}

function readStateFile(filePath, initialValue) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeValue(payload, initialValue);
  } catch {
    return cloneValue(initialValue);
  }
}

function writeStateFile(filePath, value, initialValue) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalizeValue(value, initialValue), null, 2)}\n`, "utf8");
}

function resolveWritablePath(preferredPath, initialValue) {
  try {
    ensureStateFile(preferredPath, initialValue);
    fs.accessSync(preferredPath, fs.constants.R_OK | fs.constants.W_OK);
    return preferredPath;
  } catch {
    const fallbackPath = path.join(os.tmpdir(), "openclaw-control-plane", path.basename(preferredPath));
    ensureStateFile(fallbackPath, initialValue);
    fs.accessSync(fallbackPath, fs.constants.R_OK | fs.constants.W_OK);
    return fallbackPath;
  }
}

function normalizeValue(value, initialValue) {
  const normalizedBase = cloneValue(initialValue);

  if (Array.isArray(normalizedBase)) {
    return Array.isArray(value) ? value : normalizedBase;
  }

  if (!normalizedBase || typeof normalizedBase !== "object") {
    return value ?? normalizedBase;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalizedBase;
  }

  return {
    ...normalizedBase,
    ...value
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isInitialLike(value, initialValue) {
  return JSON.stringify(normalizeValue(value, initialValue)) === JSON.stringify(normalizeValue(initialValue, initialValue));
}
