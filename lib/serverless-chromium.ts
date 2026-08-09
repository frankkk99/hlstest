import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createBrotliDecompress, createUnzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import chromium, { setupLambdaEnvironment } from "@sparticuz/chromium";

type TarFs = {
  extract: (cwd: string, options?: { chown?: boolean }) => NodeJS.WritableStream;
};

const tarFs = require("tar-fs") as TarFs;

const archiveSuffix = /\.(?:t(?:ar(?:\.(?:br|gz))?|br|gz)|br|gz)$/i;
let executablePromise: Promise<string> | null = null;

function outputPath(filePath: string) {
  if (filePath.includes("swiftshader")) return tmpdir();
  return join(tmpdir(), basename(filePath).replace(archiveSuffix, ""));
}

function isTarArchive(filePath: string) {
  return /\.t(?:ar(?:\.(?:br|gz))?|br|gz)$/i.test(filePath);
}

function isReady(filePath: string, directory = false) {
  if (!existsSync(filePath)) return false;
  if (directory) {
    try {
      return readdirSync(filePath).length > 0;
    } catch {
      return false;
    }
  }

  try {
    return statSync(filePath).size > 1024;
  } catch {
    return false;
  }
}

async function inflateWithoutChown(filePath: string) {
  const output = outputPath(filePath);
  const swiftshader = filePath.includes("swiftshader");
  if (swiftshader ? existsSync(join(tmpdir(), "libGLESv2.so")) : isReady(output, isTarArchive(filePath))) return output;

  // A failed extraction can leave a zero-byte executable or a partial folder.
  // Remove only the exact generated target before retrying.
  if (!swiftshader) {
    await rm(output, { force: true, recursive: true }).catch(() => undefined);
  }

  const source = createReadStream(filePath);
  const decompressor = filePath.endsWith(".br")
    ? createBrotliDecompress({ chunkSize: 2 ** 21 })
    : createUnzip({ chunkSize: 2 ** 21 });
  const target = isTarArchive(filePath)
    ? tarFs.extract(output, { chown: false })
    : createWriteStream(output, { mode: 0o700 });

  await pipeline(source, decompressor, target);
  return output;
}

async function prepareChromium() {
  chromium.setGraphicsMode = false;

  const binPath = join(process.cwd(), "node_modules", "@sparticuz", "chromium", "bin");
  if (!existsSync(binPath)) {
    throw new Error(`Chromium assets not found: ${binPath}`);
  }
  const executablePath = await inflateWithoutChown(join(binPath, "chromium.br"));
  const fontsPath = await inflateWithoutChown(join(binPath, "fonts.tar.br"));
  // Chromium may still probe the GLES library during startup even with WebGL
  // disabled, so make the SwiftShader files available as well.
  await inflateWithoutChown(join(binPath, "swiftshader.tar.br"));

  // Node 20+ Vercel functions use the Amazon Linux 2023 runtime. The bundled
  // libraries are needed there, but must also be extracted without tar-fs chown.
  const al2023Archive = join(binPath, "al2023.tar.br");
  if (existsSync(al2023Archive)) {
    await inflateWithoutChown(al2023Archive);
    setupLambdaEnvironment(join(tmpdir(), "al2023", "lib"));
  }

  process.env.FONTCONFIG_PATH = fontsPath;
  return executablePath;
}

export function getServerlessChromiumExecutable() {
  executablePromise ??= prepareChromium().catch((error) => {
    executablePromise = null;
    throw error;
  });

  return executablePromise;
}
