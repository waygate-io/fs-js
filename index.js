const RUNTIME_BROWSER = 0;
const RUNTIME_NODE = 1;
const RUNTIME_DENO = 2;
const RUNTIME_BUN = 3;

const runtime = detectRuntime();

const denoPath = runtime === RUNTIME_DENO ?
  await import("https://deno.land/std@0.214.0/path/mod.ts") : undefined;
const nodeFs = isNode() ? await import('fs') : undefined;


class File {
  stream() {
    return this._readable;
  }

  slice() {
    throw new Error("Must implement slice()");
  }
}

class DirectoryTree {
  constructor(rootPath) {
    this._rootPath = rootPath;
  }

  async openFile(path) {
    throw new Error("Must implement openFile()");
  }
}

class NodeFile extends File {
  constructor(f) {
    super(f);
    this._readable = f.readableWebStream();
  }

  slice(start, end, contentType) {
    return this._file.slice(start, end, contentType);
  }
}

class DenoFile extends File {
  constructor(f, start, end) {
    super(f);
    this._file = f;
    this._start = start;
    this._end = end;
    this._size = end - start;
  }

  get size() {
    return this._size;
  }

  slice(start, end, contentType) {
    return new DenoFile(this._file, start ? start : this._start, end ? end : this._end);
  }

  stream() {

    const self = this;

    if (this._start !== undefined) {
      return new ReadableStream({

        async start(controller) {
          await self._file.seek(self._start, Deno.SeekMode.Start);
          self._reader = self._file.readable.getReader();

        },

        async pull(controller) {
          const { value, done } = await self._reader.read();
          if (done) {
            controller.close();
          }
          else {
            controller.enqueue(value);
          }
        }
      });
    }
    else {
      return this._file.readable;
    }
  }
}

class BunFile extends File {
  constructor(f) {
    super(f);

    this._file = f;
    this._readable = f.stream();
  }

  slice(start, end, contentType) {
    return this._file.slice(start, end, contentType);
  }
}

class DenoDirectoryTree extends DirectoryTree {
  constructor(rootPath) {
    super(rootPath);
  }

  async openFile(path) {
    const absPath = denoPath.join(this._rootPath, path);
    const f = await Deno.open(absPath, { read: true, write: false });
    const fileInfo = await f.stat();
    return new DenoFile(f, 0, fileInfo.size);
  }
}


async function openFile(path) {
  switch (runtime) {
    case RUNTIME_BROWSER: {
      return new Promise((resolve, reject) => {
        const fileInput = document.createElement('input');
        fileInput.setAttribute('type', 'file');
        fileInput.setAttribute('hidden', '');
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', (evt) => {
          resolve(fileInput.files[0]);
          document.body.removeChild(fileInput);
        });

        fileInput.click();
      });
      break;
    }
    case RUNTIME_NODE: {
      const f = await nodeFs.promises.open(path); 
      return new NodeFile(f);
      break;
    }
    case RUNTIME_DENO: {
      // TODO: need to close the files we're opening
      const f = await Deno.open(path);
      const fileInfo = await f.stat();
      return new DenoFile(f, 0, fileInfo.size);
      break;
    }
    case RUNTIME_BUN: {
      const f = Bun.file(path);
      //return new BunFile(f);
      return f;
      break;
    }
  }
}

async function openDirectory(path) {
  switch (runtime) {
    case RUNTIME_DENO: {
      return new DenoDirectoryTree(path);
      break;
    }
    default: {
      throw new Error("Runtime not implemented:", runtime);
      break;
    }
  }
}

function detectRuntime() {
  let runtime = RUNTIME_BROWSER;
  if (typeof process !== 'undefined' && process.versions.bun !== undefined) {
    runtime = RUNTIME_BUN;
  }
  else if (isNode()) {
    runtime = RUNTIME_NODE;
  }
  else if (window.Deno !== undefined) {
    runtime = RUNTIME_DENO;
  }
  return runtime;
}

function isNode() {
  return (typeof process !== 'undefined' && process.release.name === 'node');
}

export {
  openFile,
  openDirectory,
}
